import { LIVE_PAYMENTS_ALLOWED, paymentsEnabled } from './rules'
import { stripeClient, stripeGateway } from './stripe-gateway'

/** Everything KANDO asks of the payment provider. Amounts are integer cents; idempotency keys make retries safe. */
export interface PaymentsGateway {
  /** Creates the connected account only; key e.g. `account:<providerId>` (Stripe replays it for 30 days). Store the id at once. `providerId` goes into the account's metadata, so staff can find an account whose id was never stored. */
  createAccount(i: { email: string; country: string; providerId: string; idempotencyKey: string }): Promise<{ accountId: string }>
  /** Sets the account's payout schedule (daily, safe to repeat) and returns a fresh Stripe-hosted onboarding link. */
  onboardingLink(i: { accountId: string; returnUrl: string; refreshUrl: string }): Promise<{ url: string }>
  accountReady(accountId: string): Promise<boolean>
  /**
   * `expiresAt` must be 30 minutes to 24 hours from now (else RangeError); it is sent unchanged, so a retry with the same
   * idempotency key sends the same parameters (Stripe refuses a reused key with different ones). The caller computes the
   * expiry once, stores it with the session (checkoutRef) and, while that session is still open, reuses it instead of
   * calling again; a new session needs a new key.
   * `providerId` and `customerId` go into the session's and the PaymentIntent's metadata: a booking can be deleted with an
   * account while the customer pays (awaiting-payment does not block deletion), and the webhook must still refund that
   * charge, write its ledger rows (charge, refund) with the provider id and tell the customer, although the booking row is gone.
   */
  createCheckout(i: {
    bookingId: string
    providerId: string
    customerId: string
    amountCents: number
    currency: string
    description: string
    successUrl: string
    cancelUrl: string
    expiresAt: Date
    idempotencyKey: string
  }): Promise<{ sessionId: string; url: string }>
  /**
   * transfer and refund are safe to repeat at any age with the same key: inside the gateway's idempotency window (Stripe:
   * 24 h) the key replays the first result; after it, an existing transfer/refund carrying the key in its metadata is
   * found and returned instead of making another. A key names one logical movement: a further staff refund needs its own
   * key (e.g. `staff-refund:<bookingId>:<n>`).
   */
  transfer(i: { accountId: string; amountCents: number; currency: string; paymentRef: string; bookingId: string; idempotencyKey: string }): Promise<{ transferId: string }>
  refund(i: { paymentRef: string; amountCents: number; bookingId: string; idempotencyKey: string }): Promise<{ refundId: string }>
  /** Throws BadSignatureError on a missing or wrong signature; any other error (a paid event we cannot read, no secret set) is a server error, so Stripe retries. */
  verifyEvent(rawBody: string, signature: string): GatewayEvent
}

/** The webhook body is not signed by the payment provider (the route answers 400). */
export class BadSignatureError extends Error {
  override name = 'BadSignatureError'
}

export type GatewayEvent =
  | { id: string; type: 'checkout-paid'; bookingId: string; providerId: string; customerId: string; sessionId: string; paymentRef: string; amountCents: number; currency: string }
  | { id: string; type: 'account-updated'; accountId: string }
  | { id: string; type: 'charge-disputed'; paymentRef: string }
  /** A refund failed after it was accepted (Stripe: refund.failed, or charge.refund.updated with status failed). bookingId from the refund's metadata, null for a refund made elsewhere. */
  | { id: string; type: 'refund-failed'; paymentRef: string; refundId: string; bookingId: string | null }
  | { id: string; type: 'other' }

function fromEnv(): PaymentsGateway {
  // Vercel uses STRIPE_SECRET_KEY; Stripe_Secret_Key is the owner's local .env spelling. Never put the key in a message.
  const key = process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  if (!/^(sk|rk)_test_/.test(key) && !LIVE_PAYMENTS_ALLOWED) throw new Error('Only Stripe test keys are accepted: live payments are not allowed')
  return stripeGateway(stripeClient(key))
}

let current: PaymentsGateway | undefined
/** The Stripe gateway, created on first use; refuses while PAYMENTS_ENABLED is off (also for a test gateway). */
export const gateway = (): PaymentsGateway => {
  if (!paymentsEnabled()) throw new Error('Payments are off (PAYMENTS_ENABLED is not "true")')
  return (current ??= fromEnv())
}
export const setGatewayForTests = (impl: PaymentsGateway | undefined) => {
  current = impl
}
