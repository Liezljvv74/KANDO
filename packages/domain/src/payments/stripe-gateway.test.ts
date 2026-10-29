import Stripe from 'stripe'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { STRIPE_API_VERSION, stripeClient, stripeGateway } from './stripe-gateway'

const SECRET = 'whsec_test_fake'
const CONNECT_SECRET = 'whsec_test_fake_connect'
const real = new Stripe('sk_test_fake', { apiVersion: STRIPE_API_VERSION })

/** A Stripe client whose API calls are mocks; webhooks are the SDK's own, so signatures are checked for real. */
function mockClient() {
  const m = {
    accountsCreate: vi.fn().mockResolvedValue({ id: 'acct_1' }),
    accountsRetrieve: vi.fn(),
    accountLinksCreate: vi.fn().mockResolvedValue({ url: 'https://connect.stripe.test/onboard' }),
    balanceSettingsUpdate: vi.fn().mockResolvedValue({}),
    sessionsCreate: vi.fn().mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' }),
    paymentIntentsRetrieve: vi.fn().mockResolvedValue({ id: 'pi_1', status: 'succeeded', latest_charge: 'ch_1' }),
    transfersCreate: vi.fn().mockResolvedValue({ id: 'tr_1' }),
    transfersList: vi.fn().mockResolvedValue({ data: [] }),
    refundsCreate: vi.fn().mockResolvedValue({ id: 're_1' }),
    refundsList: vi.fn().mockResolvedValue({ data: [] }),
  }
  const client = {
    v2: { core: { accounts: { create: m.accountsCreate, retrieve: m.accountsRetrieve }, accountLinks: { create: m.accountLinksCreate } } },
    balanceSettings: { update: m.balanceSettingsUpdate },
    checkout: { sessions: { create: m.sessionsCreate } },
    paymentIntents: { retrieve: m.paymentIntentsRetrieve },
    transfers: { create: m.transfersCreate, list: m.transfersList },
    refunds: { create: m.refundsCreate, list: m.refundsList },
    webhooks: real.webhooks,
  } as unknown as Stripe
  return { m, g: stripeGateway(client) }
}

const signed = (event: object, secret = SECRET) => {
  const body = JSON.stringify(event)
  return { body, signature: real.webhooks.generateTestHeaderString({ payload: body, secret }) }
}

afterEach(() => vi.unstubAllEnvs())

describe('stripeGateway: calls', () => {
  it('createAccount makes one v2 recipient account (Express dashboard) under the idempotency key, nothing else', async () => {
    const { m, g } = mockClient()
    expect(await g.createAccount({ email: 'p@example.com', country: 'DE', idempotencyKey: 'account:p-1' })).toEqual({ accountId: 'acct_1' })
    expect(m.accountsCreate).toHaveBeenCalledWith(
      {
        contact_email: 'p@example.com',
        dashboard: 'express',
        identity: { country: 'de' },
        defaults: { responsibilities: { fees_collector: 'application', losses_collector: 'application' } },
        configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
      },
      { idempotencyKey: 'account:p-1' },
    )
    expect(m.balanceSettingsUpdate).not.toHaveBeenCalled()
  })

  it('onboardingLink sets daily payouts first, then makes a v2 onboarding account link', async () => {
    const { m, g } = mockClient()
    const r = await g.onboardingLink({ accountId: 'acct_1', returnUrl: 'https://k/ret', refreshUrl: 'https://k/ref' })
    expect(r).toEqual({ url: 'https://connect.stripe.test/onboard' })
    expect(m.balanceSettingsUpdate).toHaveBeenCalledWith(
      { payments: { payouts: { schedule: { interval: 'daily' } } } },
      { stripeAccount: 'acct_1' },
    )
    expect(m.accountLinksCreate).toHaveBeenCalledWith({
      account: 'acct_1',
      use_case: {
        type: 'account_onboarding',
        account_onboarding: { return_url: 'https://k/ret', refresh_url: 'https://k/ref', collection_options: { fields: 'eventually_due' } },
      },
    })
  })

  it('accountReady needs stripe_transfers active, and payouts active when Stripe reports that capability', async () => {
    const { m, g } = mockClient()
    const acct = (transfers: string | undefined, payouts?: string) => ({
      id: 'acct_1',
      configuration: transfers
        ? { recipient: { capabilities: { stripe_balance: { stripe_transfers: { status: transfers }, ...(payouts ? { payouts: { status: payouts } } : {}) } } } }
        : null,
    })
    const ready = async (a: object) => {
      m.accountsRetrieve.mockResolvedValueOnce(a)
      return g.accountReady('acct_1')
    }
    expect(await ready(acct('active'))).toBe(true) // payouts capability absent
    expect(m.accountsRetrieve).toHaveBeenCalledWith('acct_1', { include: ['configuration.recipient'] })
    expect(await ready(acct('active', 'active'))).toBe(true)
    expect(await ready(acct('active', 'restricted'))).toBe(false) // payouts present but inactive
    expect(await ready(acct('active', 'pending'))).toBe(false)
    expect(await ready(acct('pending', 'active'))).toBe(false)
    expect(await ready(acct(undefined))).toBe(false)
  })

  it('createCheckout sends the booking id, transfer_group and the idempotency key', async () => {
    const { m, g } = mockClient()
    const expiresAt = new Date(Date.now() + 3 * 3_600_000)
    const r = await g.createCheckout({
      bookingId: 'b-1',
      amountCents: 12_345,
      currency: 'EUR',
      description: 'Garden work',
      successUrl: 'https://k/done',
      cancelUrl: 'https://k/cancel',
      expiresAt,
      idempotencyKey: 'checkout:b-1:x',
      providerId: 'p-1',
    })
    expect(r).toEqual({ sessionId: 'cs_1', url: 'https://checkout.stripe.test/cs_1' })
    const [params, opts] = m.sessionsCreate.mock.calls[0]!
    expect(opts).toEqual({ idempotencyKey: 'checkout:b-1:x' })
    expect(params).toMatchObject({
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: 12_345, product_data: { name: 'Garden work' } } }],
      client_reference_id: 'b-1',
      // providerId too: the payment webhook can record a refund of a booking deleted while the customer paid
      metadata: { bookingId: 'b-1', providerId: 'p-1' },
      payment_intent_data: { transfer_group: 'b-1', metadata: { bookingId: 'b-1', providerId: 'p-1' } },
      success_url: 'https://k/done',
      cancel_url: 'https://k/cancel',
      expires_at: Math.floor(expiresAt.getTime() / 1000),
    })
    expect(params).not.toHaveProperty('payment_method_types')
  })

  it('createCheckout never changes expiresAt: the same input gives the same parameters (idempotent retry)', async () => {
    const { m, g } = mockClient()
    const base = { bookingId: 'b', providerId: 'p', amountCents: 100, currency: 'EUR', description: 'd', successUrl: 's', cancelUrl: 'c', idempotencyKey: 'k' }
    const expiresAt = new Date(Date.now() + 2 * 3_600_000)
    await g.createCheckout({ ...base, expiresAt })
    await new Promise((r) => setTimeout(r, 1100)) // a retry a second later
    await g.createCheckout({ ...base, expiresAt })
    const [a, b] = m.sessionsCreate.mock.calls
    expect(b).toEqual(a)
  })

  it('createCheckout refuses an expiresAt outside 30 minutes to 24 hours from now (RangeError, no call)', async () => {
    const { m, g } = mockClient()
    const base = { bookingId: 'b', providerId: 'p', amountCents: 100, currency: 'EUR', description: 'd', successUrl: 's', cancelUrl: 'c', idempotencyKey: 'k' }
    const at = (ms: number) => ({ ...base, expiresAt: new Date(Date.now() + ms) })
    await expect(g.createCheckout(at(29 * 60_000))).rejects.toThrow(RangeError)
    await expect(g.createCheckout(at(24 * 3_600_000 + 60_000))).rejects.toThrow(RangeError)
    expect(m.sessionsCreate).not.toHaveBeenCalled()
    await g.createCheckout(at(31 * 60_000))
    await g.createCheckout(at(24 * 3_600_000 - 60_000))
    expect(m.sessionsCreate).toHaveBeenCalledTimes(2)
  })

  it('transfer uses the charge of the PaymentIntent as source_transaction', async () => {
    const { m, g } = mockClient()
    const r = await g.transfer({ accountId: 'acct_1', amountCents: 8800, currency: 'EUR', paymentRef: 'pi_1', bookingId: 'b-1', idempotencyKey: 'transfer:b-1' })
    expect(r).toEqual({ transferId: 'tr_1' })
    expect(m.paymentIntentsRetrieve).toHaveBeenCalledWith('pi_1')
    expect(m.transfersCreate).toHaveBeenCalledWith(
      { amount: 8800, currency: 'eur', destination: 'acct_1', source_transaction: 'ch_1', transfer_group: 'b-1', metadata: { bookingId: 'b-1', idempotencyKey: 'transfer:b-1' } },
      { idempotencyKey: 'transfer:b-1' },
    )
  })

  it('transfer returns an existing transfer of the booking with the same key and creates nothing (a retry after the 24 h key window)', async () => {
    const { m, g } = mockClient()
    m.transfersList.mockResolvedValueOnce({ data: [{ id: 'tr_other', metadata: { idempotencyKey: 'x' } }, { id: 'tr_old', metadata: { bookingId: 'b-1', idempotencyKey: 'transfer:b-1' } }] })
    const r = await g.transfer({ accountId: 'acct_1', amountCents: 8800, currency: 'EUR', paymentRef: 'pi_1', bookingId: 'b-1', idempotencyKey: 'transfer:b-1' })
    expect(r).toEqual({ transferId: 'tr_old' })
    expect(m.transfersList).toHaveBeenCalledWith({ transfer_group: 'b-1', limit: 100 })
    expect(m.transfersCreate).not.toHaveBeenCalled()
    expect(m.paymentIntentsRetrieve).not.toHaveBeenCalled()
  })

  it('transfer refuses a PaymentIntent that has not succeeded or has no charge', async () => {
    const { m, g } = mockClient()
    const t = { accountId: 'a', amountCents: 1, currency: 'EUR', paymentRef: 'pi_1', bookingId: 'b', idempotencyKey: 'k' }
    m.paymentIntentsRetrieve.mockResolvedValueOnce({ id: 'pi_1', status: 'processing', latest_charge: 'ch_1' })
    await expect(g.transfer(t)).rejects.toThrow(/succeeded/)
    m.paymentIntentsRetrieve.mockResolvedValueOnce({ id: 'pi_1', status: 'succeeded', latest_charge: null })
    await expect(g.transfer(t)).rejects.toThrow(/charge/)
    expect(m.transfersCreate).not.toHaveBeenCalled()
  })

  it('refund refunds the PaymentIntent with the idempotency key', async () => {
    const { m, g } = mockClient()
    expect(await g.refund({ paymentRef: 'pi_1', amountCents: 500, bookingId: 'b-1', idempotencyKey: 'refund:b-1' })).toEqual({ refundId: 're_1' })
    expect(m.refundsList).toHaveBeenCalledWith({ payment_intent: 'pi_1', limit: 100 })
    expect(m.refundsCreate).toHaveBeenCalledWith({ payment_intent: 'pi_1', amount: 500, metadata: { bookingId: 'b-1', idempotencyKey: 'refund:b-1' } }, { idempotencyKey: 'refund:b-1' })
  })

  it('refund returns an existing refund of the PaymentIntent with the same key and creates nothing (a retry after the 24 h key window)', async () => {
    const { m, g } = mockClient()
    m.refundsList.mockResolvedValueOnce({ data: [{ id: 're_staff', metadata: { idempotencyKey: 'staff-refund:b-1:1' } }, { id: 're_old', metadata: { idempotencyKey: 'refund:b-1' } }] })
    expect(await g.refund({ paymentRef: 'pi_1', amountCents: 500, bookingId: 'b-1', idempotencyKey: 'refund:b-1' })).toEqual({ refundId: 're_old' })
    expect(m.refundsCreate).not.toHaveBeenCalled()
  })

  it('the client times out a hung call after 15 s and retries at most twice (a hung call holds the booking lock)', () => {
    const c = stripeClient('sk_test_fake')
    expect(c.getApiField('timeout')).toBe(15_000)
    expect(c.getMaxNetworkRetries()).toBe(2)
  })
})

describe('stripeGateway: verifyEvent', () => {
  const session = (payment_status: string) => ({
    id: 'cs_1',
    object: 'checkout.session',
    payment_status,
    payment_intent: 'pi_1',
    amount_total: 12_345,
    currency: 'eur',
    metadata: { bookingId: 'b-1' },
  })
  const ev = (type: string, object: object, extra: object = {}) => ({ id: 'evt_1', object: 'event', type, livemode: false, data: { object }, ...extra })

  it('maps a paid checkout.session.completed to checkout-paid with the PaymentIntent as paymentRef', () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET)
    const { g } = mockClient()
    const { body, signature } = signed(ev('checkout.session.completed', session('paid')))
    expect(g.verifyEvent(body, signature)).toEqual({
      id: 'evt_1',
      type: 'checkout-paid',
      bookingId: 'b-1',
      sessionId: 'cs_1',
      paymentRef: 'pi_1',
      amountCents: 12_345,
      currency: 'EUR',
    })
  })

  it('an unpaid completed session (delayed payment method) is other; async_payment_succeeded is checkout-paid', () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET)
    const { g } = mockClient()
    const a = signed(ev('checkout.session.completed', session('unpaid')))
    expect(g.verifyEvent(a.body, a.signature)).toEqual({ id: 'evt_1', type: 'other' })
    const b = signed(ev('checkout.session.async_payment_succeeded', session('paid')))
    expect(g.verifyEvent(b.body, b.signature)).toMatchObject({ type: 'checkout-paid', paymentRef: 'pi_1' })
  })

  it('maps account.updated (connected-account endpoint secret) to account-updated', () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET)
    vi.stubEnv('STRIPE_CONNECT_WEBHOOK_SECRET', CONNECT_SECRET)
    const { g } = mockClient()
    const { body, signature } = signed(ev('account.updated', { id: 'acct_9', object: 'account' }, { account: 'acct_9' }), CONNECT_SECRET)
    expect(g.verifyEvent(body, signature)).toEqual({ id: 'evt_1', type: 'account-updated', accountId: 'acct_9' })
  })

  it('maps charge.dispute.created to charge-disputed with the PaymentIntent', () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET)
    const { g } = mockClient()
    const { body, signature } = signed(ev('charge.dispute.created', { id: 'dp_1', object: 'dispute', charge: 'ch_1', payment_intent: 'pi_1' }))
    expect(g.verifyEvent(body, signature)).toEqual({ id: 'evt_1', type: 'charge-disputed', paymentRef: 'pi_1' })
  })

  it('a dispute without a PaymentIntent is other (not one of ours)', () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET)
    const { g } = mockClient()
    const { body, signature } = signed(ev('charge.dispute.created', { id: 'dp_1', object: 'dispute', charge: 'ch_1', payment_intent: null }))
    expect(g.verifyEvent(body, signature)).toEqual({ id: 'evt_1', type: 'other' })
  })

  it('a paid session missing bookingId, amount_total, PaymentIntent or currency throws (the route answers 500, Stripe retries)', () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET)
    const { g } = mockClient()
    for (const broken of [
      { ...session('paid'), metadata: {} },
      { ...session('paid'), amount_total: null },
      { ...session('paid'), payment_intent: null },
      { ...session('paid'), currency: null },
    ]) {
      const { body, signature } = signed(ev('checkout.session.completed', broken))
      expect(() => g.verifyEvent(body, signature)).toThrow(/cs_1/)
    }
    const unpaid = signed(ev('checkout.session.completed', { ...session('unpaid'), metadata: {} }))
    expect(g.verifyEvent(unpaid.body, unpaid.signature)).toEqual({ id: 'evt_1', type: 'other' })
  })

  it('maps everything else, and any live-mode event, to other', () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET)
    const { g } = mockClient()
    const a = signed(ev('customer.created', { id: 'cus_1' }))
    expect(g.verifyEvent(a.body, a.signature)).toEqual({ id: 'evt_1', type: 'other' })
    const b = signed(ev('checkout.session.completed', session('paid'), { livemode: true }))
    expect(g.verifyEvent(b.body, b.signature)).toEqual({ id: 'evt_1', type: 'other' })
  })

  it('throws on a bad signature, a changed body, or a missing webhook secret', () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET)
    const { g } = mockClient()
    const { body, signature } = signed(ev('checkout.session.completed', session('paid')))
    expect(() => g.verifyEvent(body, 'garbage')).toThrow()
    expect(() => g.verifyEvent(body.replace('12345', '1'), signature)).toThrow()
    const other = signed(ev('checkout.session.completed', session('paid')), 'whsec_someone_else')
    expect(() => g.verifyEvent(other.body, other.signature)).toThrow()
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '')
    expect(() => g.verifyEvent(body, signature)).toThrow(/STRIPE_WEBHOOK_SECRET/)
  })
})
