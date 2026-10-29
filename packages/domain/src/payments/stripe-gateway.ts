/*
 * Stripe implementation of PaymentsGateway (Stripe docs read 29 Oct 2026; SDK stripe 23.0.1, API version pinned below).
 *
 * Decision: SEPARATE CHARGES AND TRANSFERS (https://docs.stripe.com/connect/separate-charges-and-transfers).
 * The customer pays KANDO's platform account through Checkout; the money stays in the platform's Stripe balance until
 * the booking is settled, then `transfer` moves the provider's share (the commission stays behind: Stripe says to
 * collect fees "by reducing the amount it transfers", no application_fee_amount) and `refund` returns the rest.
 * Destination charges move the money to the provider at payment time, so they cannot hold it until the job is done.
 * - transfer_group = booking id on the PaymentIntent (and so on its charge) and on the transfer.
 * - source_transaction = the charge: "the transfer request returns success regardless of your available balance if the
 *   related charge hasn't settled yet", and the transfer can never exceed that charge.
 * - Hold bound: MAX_HOLD_DAYS / MAX_PAY_AHEAD_DAYS in rules.ts (Stripe states no limit for the platform's own balance;
 *   the bound is borrowed from https://docs.stripe.com/connect/manual-payouts). The platform balance must be on manual
 *   payouts in the Dashboard, or Stripe pays it out to KANDO's bank account.
 *
 * Connected accounts: Accounts v2 (https://docs.stripe.com/connect/marketplace/tasks/create) with the `recipient`
 * configuration (stripe_balance.stripe_transfers), Express dashboard, fees and losses collected by the application
 * (required for that combination), Stripe-hosted onboarding through a v2 account link
 * (https://docs.stripe.com/api/v2/core/account-links/create), daily automatic payouts set with the Balance Settings API
 * (Accounts v2 cannot set payout settings: https://docs.stripe.com/connect/manual-payouts), applied before every
 * onboarding link so a failure there never loses a created account. Account creation carries an idempotency key (v2
 * replays it for 30 days: https://docs.stripe.com/api-v2-overview#idempotency). Ready means stripe_transfers is
 * `active`, and stripe_balance.payouts too when Stripe reports that capability (money must reach the bank).
 *
 * paymentRef is the PaymentIntent id: it is on the Checkout Session in the webhook (the charge id is not), refunds take
 * it directly (`payment_intent`), a dispute names it, and `transfer` looks up its latest_charge for source_transaction
 * (only for a succeeded PaymentIntent).
 *
 * Webhooks (https://docs.stripe.com/webhooks#verify-events, https://docs.stripe.com/connect/webhooks): the raw body and
 * the Stripe-Signature header go to constructEvent. Two endpoints, two secrets: STRIPE_WEBHOOK_SECRET ("Your account":
 * checkout.session.completed, checkout.session.async_payment_succeeded, charge.dispute.created, refund.failed) and the optional
 * STRIPE_CONNECT_WEBHOOK_SECRET ("Connected accounts": v1 account.updated is only sent in that scope). A completed
 * session is paid only when payment_status is 'paid'; delayed methods (SEPA debit) pay later with
 * checkout.session.async_payment_succeeded (the event table on the separate-charges-and-transfers page). The
 * endpoints use snapshot payloads with the API version below (an event has the shape of its endpoint's version).
 */
import Stripe from 'stripe'

import { BadSignatureError, type GatewayEvent, type PaymentsGateway } from './gateway'
import { LIVE_PAYMENTS_ALLOWED } from './rules'

export const STRIPE_API_VERSION = '2026-09-30.endive'

/** Tags KANDO's Checkout Sessions in the Stripe Dashboard (fixed: a random part would break idempotent retries). */
const INTEGRATION_ID = 'kando-booking-pay-qzvhkmrt'

// Stripe accepts a Checkout expiry 30 minutes to 24 hours after creation (SDK docs of expires_at); half a minute of
// margin at the low end because the session is created a moment after this check.
const MIN_EXPIRY_MS = 30.5 * 60_000
const MAX_EXPIRY_MS = 24 * 3_600_000

// A hung call must not hold a booking row lock (settle) for minutes: 15 s per attempt, two retries (SDK default 80 s).
export const stripeClient = (key: string): Stripe => new Stripe(key, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2, timeout: 15_000 })

export function stripeGateway(client: Stripe): PaymentsGateway {
  return {
    async createAccount({ email, country, providerId, idempotencyKey }) {
      const account = await client.v2.core.accounts.create(
        {
          contact_email: email,
          dashboard: 'express',
          identity: { country: country.toLowerCase() },
          defaults: { responsibilities: { fees_collector: 'application', losses_collector: 'application' } },
          configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
          metadata: { providerId },
        },
        { idempotencyKey },
      )
      return { accountId: account.id }
    },

    async onboardingLink({ accountId, returnUrl, refreshUrl }) {
      await client.balanceSettings.update({ payments: { payouts: { schedule: { interval: 'daily' } } } }, { stripeAccount: accountId })
      const link = await client.v2.core.accountLinks.create({
        account: accountId,
        use_case: {
          type: 'account_onboarding',
          // Collect everything up front (identity, bank account, DAC7 tax details) so payouts are not stopped later.
          account_onboarding: { return_url: returnUrl, refresh_url: refreshUrl, collection_options: { fields: 'eventually_due' } },
        },
      })
      return { url: link.url }
    },

    async accountReady(accountId) {
      const account = await client.v2.core.accounts.retrieve(accountId, { include: ['configuration.recipient'] })
      const balance = account.configuration?.recipient?.capabilities?.stripe_balance
      return balance?.stripe_transfers?.status === 'active' && (!balance.payouts || balance.payouts.status === 'active')
    },

    async createCheckout(i) {
      const ahead = i.expiresAt.getTime() - Date.now()
      if (!(ahead >= MIN_EXPIRY_MS && ahead <= MAX_EXPIRY_MS)) throw new RangeError('Checkout expiresAt must be 30 minutes to 24 hours from now')
      const session = await client.checkout.sessions.create(
        {
          mode: 'payment',
          line_items: [{ quantity: 1, price_data: { currency: i.currency.toLowerCase(), unit_amount: i.amountCents, product_data: { name: i.description } } }],
          client_reference_id: i.bookingId,
          metadata: { bookingId: i.bookingId, providerId: i.providerId, customerId: i.customerId },
          payment_intent_data: { transfer_group: i.bookingId, metadata: { bookingId: i.bookingId, providerId: i.providerId, customerId: i.customerId } },
          success_url: i.successUrl,
          cancel_url: i.cancelUrl,
          expires_at: Math.floor(i.expiresAt.getTime() / 1000),
          integration_identifier: INTEGRATION_ID,
        },
        { idempotencyKey: i.idempotencyKey },
      )
      if (!session.url) throw new Error(`Checkout Session ${session.id} has no URL`)
      return { sessionId: session.id, url: session.url }
    },

    // Stripe keeps idempotency keys for 24 h; a settlement retried later finds its earlier movement by the key in metadata.
    // ponytail: one page of 100 per booking (a booking has one transfer and a handful of refunds).
    async transfer(i) {
      const existing = (await client.transfers.list({ transfer_group: i.bookingId, limit: 100 })).data.find((t) => t.metadata?.idempotencyKey === i.idempotencyKey)
      if (existing) return { transferId: existing.id }
      const intent = await client.paymentIntents.retrieve(i.paymentRef)
      if (intent.status !== 'succeeded') throw new Error(`PaymentIntent ${i.paymentRef} has not succeeded (${intent.status})`)
      const charge = typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id
      if (!charge) throw new Error(`PaymentIntent ${i.paymentRef} has no charge to transfer from`)
      const transfer = await client.transfers.create(
        {
          amount: i.amountCents,
          currency: i.currency.toLowerCase(),
          destination: i.accountId,
          source_transaction: charge,
          transfer_group: i.bookingId,
          metadata: { bookingId: i.bookingId, idempotencyKey: i.idempotencyKey },
        },
        { idempotencyKey: i.idempotencyKey },
      )
      return { transferId: transfer.id }
    },

    async refund(i) {
      const existing = (await client.refunds.list({ payment_intent: i.paymentRef, limit: 100 })).data.find((r) => r.metadata?.idempotencyKey === i.idempotencyKey)
      if (existing) return { refundId: existing.id }
      const refund = await client.refunds.create(
        { payment_intent: i.paymentRef, amount: i.amountCents, metadata: { bookingId: i.bookingId, idempotencyKey: i.idempotencyKey } },
        { idempotencyKey: i.idempotencyKey },
      )
      return { refundId: refund.id }
    },

    verifyEvent(rawBody, signature) {
      const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter((s): s is string => !!s)
      if (secrets.length === 0) throw new Error('STRIPE_WEBHOOK_SECRET is not set')
      let event: Stripe.Event | undefined
      let error: unknown
      for (const secret of secrets) {
        try {
          event = client.webhooks.constructEvent(rawBody, signature, secret)
          break
        } catch (e) {
          error = e
        }
      }
      if (!event) throw error instanceof Stripe.errors.StripeSignatureVerificationError ? new BadSignatureError(error.message) : error
      return toGatewayEvent(event)
    },
  }
}

function toGatewayEvent(event: Stripe.Event): GatewayEvent {
  const other = { id: event.id, type: 'other' } as const
  if (event.livemode && !LIVE_PAYMENTS_ALLOWED) return other // a production Connect endpoint also receives live events
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const s = event.data.object
      const { bookingId, providerId, customerId } = s.metadata ?? {}
      const paymentRef = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id
      if (s.payment_status !== 'paid') return other // delayed method: async_payment_succeeded follows
      // A paid session we cannot attribute must not be dropped: throwing makes the route answer 500, so Stripe retries.
      if (!bookingId || !providerId || !customerId || !paymentRef || s.amount_total == null || !s.currency) throw new Error(`Paid Checkout Session ${s.id} lacks bookingId, providerId, customerId, amount, PaymentIntent or currency`)
      return { id: event.id, type: 'checkout-paid', bookingId, providerId, customerId, sessionId: s.id, paymentRef, amountCents: s.amount_total, currency: s.currency.toUpperCase() }
    }
    case 'refund.failed':
    case 'charge.refund.updated': {
      const r = event.data.object
      const pi = typeof r.payment_intent === 'string' ? r.payment_intent : r.payment_intent?.id
      if (r.status !== 'failed' || !pi) return other
      return { id: event.id, type: 'refund-failed', paymentRef: pi, refundId: r.id, bookingId: r.metadata?.bookingId ?? null }
    }
    case 'account.updated':
      return { id: event.id, type: 'account-updated', accountId: event.account ?? event.data.object.id }
    case 'charge.dispute.created': {
      const pi = event.data.object.payment_intent // every KANDO charge comes from a Checkout PaymentIntent
      if (!pi) return other
      return { id: event.id, type: 'charge-disputed', paymentRef: typeof pi === 'string' ? pi : pi.id }
    }
    default:
      return other
  }
}
