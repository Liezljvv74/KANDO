import { describe, expect, it } from 'vitest'

import { fakeGateway } from './fake-gateway'

const checkout = (key: string) => ({
  bookingId: 'b-1',
  amountCents: 1000,
  currency: 'EUR',
  description: 'job',
  successUrl: 's',
  cancelUrl: 'c',
  expiresAt: new Date(),
  idempotencyKey: key,
})

describe('fakeGateway', () => {
  it('is idempotent by key like Stripe: same key, same result, recorded once', async () => {
    const g = fakeGateway()
    const a = await g.createCheckout(checkout('checkout:b-1'))
    const b = await g.createCheckout(checkout('checkout:b-1'))
    const c = await g.createCheckout(checkout('checkout:b-2'))
    expect(b).toEqual(a)
    expect(c.sessionId).not.toBe(a.sessionId)
    const t = { accountId: 'acct', amountCents: 5, currency: 'EUR', paymentRef: 'pi', bookingId: 'b-1', idempotencyKey: 'transfer:b-1' }
    expect(await g.transfer(t)).toEqual(await g.transfer(t))
    const r = { paymentRef: 'pi', amountCents: 5, idempotencyKey: 'refund:b-1' }
    expect(await g.refund(r)).toEqual(await g.refund(r))
    expect(g.calls.map((x) => x.method)).toEqual(['createCheckout', 'createCheckout', 'transfer', 'refund'])
  })

  it('accountReady follows the ready set', async () => {
    const g = fakeGateway()
    const { accountId } = await g.createAccount({ email: 'p@example.com', country: 'DE' })
    expect(await g.accountReady(accountId)).toBe(false)
    g.ready.add(accountId)
    expect(await g.accountReady(accountId)).toBe(true)
    expect((await g.onboardingLink({ accountId, returnUrl: 'r', refreshUrl: 'f' })).url).toContain(accountId)
  })

  it('verifyEvent accepts only signatures it produced, for the exact body', () => {
    const g = fakeGateway()
    const e = { id: 'evt_1', type: 'account-updated', accountId: 'acct_1' } as const
    const { body, signature } = g.event(e)
    expect(g.verifyEvent(body, signature)).toEqual(e)
    expect(() => g.verifyEvent(body, 'forged')).toThrow()
    expect(() => g.verifyEvent(body.replace('acct_1', 'acct_2'), signature)).toThrow()
    expect(() => fakeGateway().verifyEvent(body, signature)).toThrow()
  })
})
