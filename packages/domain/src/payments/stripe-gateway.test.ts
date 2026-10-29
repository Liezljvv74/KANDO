import Stripe from 'stripe'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { STRIPE_API_VERSION, stripeGateway } from './stripe-gateway'

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
    paymentIntentsRetrieve: vi.fn().mockResolvedValue({ id: 'pi_1', latest_charge: 'ch_1' }),
    transfersCreate: vi.fn().mockResolvedValue({ id: 'tr_1' }),
    refundsCreate: vi.fn().mockResolvedValue({ id: 're_1' }),
  }
  const client = {
    v2: { core: { accounts: { create: m.accountsCreate, retrieve: m.accountsRetrieve }, accountLinks: { create: m.accountLinksCreate } } },
    balanceSettings: { update: m.balanceSettingsUpdate },
    checkout: { sessions: { create: m.sessionsCreate } },
    paymentIntents: { retrieve: m.paymentIntentsRetrieve },
    transfers: { create: m.transfersCreate },
    refunds: { create: m.refundsCreate },
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
  it('createAccount makes a v2 recipient account with the Express dashboard and daily payouts', async () => {
    const { m, g } = mockClient()
    expect(await g.createAccount({ email: 'p@example.com', country: 'DE' })).toEqual({ accountId: 'acct_1' })
    expect(m.accountsCreate).toHaveBeenCalledWith({
      contact_email: 'p@example.com',
      dashboard: 'express',
      identity: { country: 'de' },
      defaults: { responsibilities: { fees_collector: 'application', losses_collector: 'application' } },
      configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
    })
    expect(m.balanceSettingsUpdate).toHaveBeenCalledWith(
      { payments: { payouts: { schedule: { interval: 'daily' } } } },
      { stripeAccount: 'acct_1' },
    )
  })

  it('onboardingLink makes a v2 onboarding account link', async () => {
    const { m, g } = mockClient()
    const r = await g.onboardingLink({ accountId: 'acct_1', returnUrl: 'https://k/ret', refreshUrl: 'https://k/ref' })
    expect(r).toEqual({ url: 'https://connect.stripe.test/onboard' })
    expect(m.accountLinksCreate).toHaveBeenCalledWith({
      account: 'acct_1',
      use_case: {
        type: 'account_onboarding',
        account_onboarding: { return_url: 'https://k/ret', refresh_url: 'https://k/ref', collection_options: { fields: 'eventually_due' } },
      },
    })
  })

  it('accountReady is true only when stripe_transfers is active', async () => {
    const { m, g } = mockClient()
    const acct = (status: string | undefined) => ({
      id: 'acct_1',
      configuration: status ? { recipient: { capabilities: { stripe_balance: { stripe_transfers: { status } } } } } : null,
    })
    m.accountsRetrieve.mockResolvedValueOnce(acct('active'))
    expect(await g.accountReady('acct_1')).toBe(true)
    expect(m.accountsRetrieve).toHaveBeenCalledWith('acct_1', { include: ['configuration.recipient'] })
    m.accountsRetrieve.mockResolvedValueOnce(acct('pending'))
    expect(await g.accountReady('acct_1')).toBe(false)
    m.accountsRetrieve.mockResolvedValueOnce(acct(undefined))
    expect(await g.accountReady('acct_1')).toBe(false)
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
    })
    expect(r).toEqual({ sessionId: 'cs_1', url: 'https://checkout.stripe.test/cs_1' })
    const [params, opts] = m.sessionsCreate.mock.calls[0]!
    expect(opts).toEqual({ idempotencyKey: 'checkout:b-1:x' })
    expect(params).toMatchObject({
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: 12_345, product_data: { name: 'Garden work' } } }],
      client_reference_id: 'b-1',
      metadata: { bookingId: 'b-1' },
      payment_intent_data: { transfer_group: 'b-1', metadata: { bookingId: 'b-1' } },
      success_url: 'https://k/done',
      cancel_url: 'https://k/cancel',
      expires_at: Math.floor(expiresAt.getTime() / 1000),
    })
    expect(params).not.toHaveProperty('payment_method_types')
  })

  it('createCheckout keeps expires_at inside Stripe’s 30 minutes to 24 hours', async () => {
    const { m, g } = mockClient()
    const base = { bookingId: 'b', amountCents: 100, currency: 'EUR', description: 'd', successUrl: 's', cancelUrl: 'c', idempotencyKey: 'k' }
    const now = Date.now() / 1000
    await g.createCheckout({ ...base, expiresAt: new Date(Date.now() + 60_000) })
    await g.createCheckout({ ...base, expiresAt: new Date(Date.now() + 5 * 86_400_000) })
    const [soon, far] = m.sessionsCreate.mock.calls.map((c) => c[0].expires_at as number)
    expect(soon).toBeGreaterThanOrEqual(now + 30 * 60)
    expect(far).toBeLessThanOrEqual(now + 24 * 3600)
  })

  it('transfer uses the charge of the PaymentIntent as source_transaction', async () => {
    const { m, g } = mockClient()
    const r = await g.transfer({ accountId: 'acct_1', amountCents: 8800, currency: 'EUR', paymentRef: 'pi_1', bookingId: 'b-1', idempotencyKey: 'transfer:b-1' })
    expect(r).toEqual({ transferId: 'tr_1' })
    expect(m.paymentIntentsRetrieve).toHaveBeenCalledWith('pi_1')
    expect(m.transfersCreate).toHaveBeenCalledWith(
      { amount: 8800, currency: 'eur', destination: 'acct_1', source_transaction: 'ch_1', transfer_group: 'b-1', metadata: { bookingId: 'b-1' } },
      { idempotencyKey: 'transfer:b-1' },
    )
  })

  it('transfer refuses a PaymentIntent without a charge', async () => {
    const { m, g } = mockClient()
    m.paymentIntentsRetrieve.mockResolvedValueOnce({ id: 'pi_1', latest_charge: null })
    await expect(
      g.transfer({ accountId: 'a', amountCents: 1, currency: 'EUR', paymentRef: 'pi_1', bookingId: 'b', idempotencyKey: 'k' }),
    ).rejects.toThrow(/charge/)
    expect(m.transfersCreate).not.toHaveBeenCalled()
  })

  it('refund refunds the PaymentIntent with the idempotency key', async () => {
    const { m, g } = mockClient()
    expect(await g.refund({ paymentRef: 'pi_1', amountCents: 500, idempotencyKey: 'refund:b-1' })).toEqual({ refundId: 're_1' })
    expect(m.refundsCreate).toHaveBeenCalledWith({ payment_intent: 'pi_1', amount: 500 }, { idempotencyKey: 'refund:b-1' })
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
