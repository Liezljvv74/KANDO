import { describe, expect, it } from 'vitest'

import { fakeGateway } from './fake-gateway'

const checkout = (key: string) => ({
  bookingId: 'b-1',
  providerId: 'p-1',
  customerId: 'u-1',
  amountCents: 1000,
  currency: 'EUR',
  description: 'job',
  successUrl: 's',
  cancelUrl: 'c',
  expiresAt: new Date('2026-11-02T10:00:00Z'),
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
    const r = { paymentRef: 'pi', amountCents: 5, bookingId: 'b-1', idempotencyKey: 'refund:b-1' }
    expect(await g.refund(r)).toEqual(await g.refund(r))
    expect(g.calls.map((x) => x.method)).toEqual(['createCheckout', 'createCheckout', 'transfer', 'refund'])
    expect(g.attempts).toEqual({ createCheckout: 3, transfer: 2, refund: 2 }) // replays count as attempts
  })

  it('after the key window (forgetKeys) a transfer or refund with the same key returns the existing object, like the gateway lookup', async () => {
    const g = fakeGateway()
    const t = { accountId: 'acct', amountCents: 5, currency: 'EUR', paymentRef: 'pi', bookingId: 'b-1', idempotencyKey: 'transfer:b-1' }
    const r = { paymentRef: 'pi', amountCents: 5, bookingId: 'b-1', idempotencyKey: 'refund:b-1' }
    const first = [await g.transfer(t), await g.refund(r)]
    g.forgetKeys()
    expect([await g.transfer(t), await g.refund(r)]).toEqual(first)
    expect(g.calls.map((x) => x.method)).toEqual(['transfer', 'refund'])
    await g.refund({ ...r, idempotencyKey: 'refund:b-2' }) // a new key is a new refund
    expect(g.calls).toHaveLength(3)
  })

  it('a reused key with different parameters throws like Stripe’s idempotency_error and records nothing', async () => {
    const g = fakeGateway()
    await g.createCheckout(checkout('checkout:b-1'))
    await expect(g.createCheckout({ ...checkout('checkout:b-1'), expiresAt: new Date(Date.now() + 1000) })).rejects.toThrow(/idempotency/)
    await expect(g.createCheckout({ ...checkout('checkout:b-1'), amountCents: 999 })).rejects.toThrow(/idempotency/)
    expect(g.calls).toHaveLength(1)
  })

  it('createAccount is idempotent by key', async () => {
    const g = fakeGateway()
    const a = await g.createAccount({ email: 'p@example.com', country: 'DE', idempotencyKey: 'account:p-1' })
    expect(await g.createAccount({ email: 'p@example.com', country: 'DE', idempotencyKey: 'account:p-1' })).toEqual(a)
    expect((await g.createAccount({ email: 'q@example.com', country: 'DE', idempotencyKey: 'account:p-2' })).accountId).not.toBe(a.accountId)
    expect(g.calls.filter((c) => c.method === 'createAccount')).toHaveLength(2)
  })

  it('accountReady follows the ready set', async () => {
    const g = fakeGateway()
    const { accountId } = await g.createAccount({ email: 'p@example.com', country: 'DE', idempotencyKey: 'account:p-1' })
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
