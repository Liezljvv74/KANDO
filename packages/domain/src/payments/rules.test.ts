import { afterEach, describe, expect, it, vi } from 'vitest'

import { gateway, setGatewayForTests, type PaymentsGateway } from './gateway'
import { canTransact, checkoutExpiry, commissionFor, LIVE_PAYMENTS_ALLOWED, MAX_HOLD_DAYS, MAX_PAY_AHEAD_DAYS, paymentsEnabled, toCents } from './rules'

afterEach(() => {
  vi.unstubAllEnvs()
  setGatewayForTests(undefined)
})

/** Clears every key spelling so a test sees only what it sets. */
const keys = (env: Record<string, string>) => {
  vi.stubEnv('STRIPE_SECRET_KEY', '')
  vi.stubEnv('Stripe_Secret_Key', '')
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
}

describe('commissionFor', () => {
  it('is 12 on 100 at 0.12', () => expect(commissionFor(100, 0.12)).toBe(12))
  it('rounds 3.9996 (33.33 at 0.12) to 4', () => expect(commissionFor(33.33, 0.12)).toBe(4))
  it('rounds 0.006 (0.05 at 0.12) up to 0.01', () => expect(commissionFor(0.05, 0.12)).toBe(0.01))
  it('rounds an exact half cent up', () => expect(commissionFor(0.25, 0.1)).toBe(0.03))
  it('is 0 on 0', () => expect(commissionFor(0, 0.12)).toBe(0))
  it('is 4.80 on 40 at 0.12', () => expect(commissionFor(40, 0.12)).toBe(4.8))
  it('rejects a negative share or a rate outside 0..1', () => {
    expect(() => commissionFor(-1, 0.12)).toThrow()
    expect(() => commissionFor(10, 1.5)).toThrow()
    expect(() => commissionFor(10, -0.1)).toThrow()
  })
})

describe('toCents', () => {
  it('is 1999 for 19.99', () => expect(toCents(19.99)).toBe(1999))
  it('is floating-point safe', () => {
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(toCents(1.005)).toBe(101)
    expect(toCents(4.35)).toBe(435)
    expect(toCents(0.07)).toBe(7)
  })
  it('handles the largest numeric(10,2) amount', () => expect(toCents(99_999_999.99)).toBe(9_999_999_999))
  it('rejects negative, NaN and infinite amounts', () => {
    expect(() => toCents(-0.01)).toThrow()
    expect(() => toCents(Number.NaN)).toThrow()
    expect(() => toCents(Number.POSITIVE_INFINITY)).toThrow()
  })
})

describe('paymentsEnabled and canTransact', () => {
  it('payments are on only for exactly "true"', () => {
    vi.stubEnv('PAYMENTS_ENABLED', 'TRUE')
    expect(paymentsEnabled()).toBe(false)
    vi.stubEnv('PAYMENTS_ENABLED', 'true')
    expect(paymentsEnabled()).toBe(true)
  })
  it('is true for any provider when payments are off', () => {
    vi.stubEnv('PAYMENTS_ENABLED', '')
    expect(canTransact({ payoutsReadyAt: null })).toBe(true)
    expect(canTransact({ payoutsReadyAt: new Date() })).toBe(true)
  })
  it('is false without payoutsReadyAt when payments are on', () => {
    vi.stubEnv('PAYMENTS_ENABLED', 'true')
    expect(canTransact({ payoutsReadyAt: null })).toBe(false)
    expect(canTransact({ payoutsReadyAt: new Date() })).toBe(true)
  })
  it('live payments stay off and the hold limit is a positive number of days', () => {
    expect(LIVE_PAYMENTS_ALLOWED).toBe(false)
    expect(MAX_HOLD_DAYS).toBeGreaterThan(0)
  })
  it('the pay-ahead limit leaves at least 28 days of the hold bound for the job, Finished + 7 days and slack', () => {
    expect(MAX_PAY_AHEAD_DAYS).toBe(60)
    expect(MAX_PAY_AHEAD_DAYS).toBeLessThan(MAX_HOLD_DAYS - 28)
  })
})

describe('gateway()', () => {
  it('throws for an sk_live_ key', () => {
    keys({ PAYMENTS_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_live_fake' })
    expect(() => gateway()).toThrow(/live/i)
  })
  it('throws for an rk_live_ key in the fallback spelling', () => {
    keys({ PAYMENTS_ENABLED: 'true', Stripe_Secret_Key: 'rk_live_fake' })
    expect(() => gateway()).toThrow(/live/i)
  })
  it('throws when payments are off, even with a test key or a test gateway', () => {
    keys({ PAYMENTS_ENABLED: 'false', STRIPE_SECRET_KEY: 'sk_test_fake' })
    expect(() => gateway()).toThrow(/PAYMENTS_ENABLED/)
    setGatewayForTests({} as PaymentsGateway)
    expect(() => gateway()).toThrow(/PAYMENTS_ENABLED/)
  })
  it('throws when no key is set', () => {
    keys({ PAYMENTS_ENABLED: 'true' })
    expect(() => gateway()).toThrow(/STRIPE_SECRET_KEY/)
  })
  it('never puts the key into the error message', () => {
    keys({ PAYMENTS_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_live_notreal987' })
    expect(() => gateway()).toThrow(expect.objectContaining({ message: expect.not.stringContaining('notreal987') }))
  })
  it('accepts sk_test_, rk_test_ and the Stripe_Secret_Key fallback', () => {
    keys({ PAYMENTS_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_fake' })
    expect(typeof gateway().createCheckout).toBe('function')
    setGatewayForTests(undefined)
    keys({ PAYMENTS_ENABLED: 'true', Stripe_Secret_Key: 'rk_test_fake' })
    expect(typeof gateway().transfer).toBe('function')
  })
  it('returns the test gateway when one is set', () => {
    keys({ PAYMENTS_ENABLED: 'true' })
    const fake = {} as PaymentsGateway
    setGatewayForTests(fake)
    expect(gateway()).toBe(fake)
  })
})

describe('checkoutExpiry', () => {
  const now = new Date('2027-01-10T12:00:00Z')
  const min = 60_000
  const h = 60 * min
  const exp = (payByIn: number, at = now) => checkoutExpiry(new Date(now.getTime() + payByIn), at)?.getTime()
  it('is payBy itself when payBy is 31 minutes to 23 h 31 min away', () => {
    expect(exp(31 * min)).toBe(now.getTime() + 31 * min)
    expect(exp(23 * h + 30 * min)).toBe(now.getTime() + 23 * h + 30 * min)
  })
  it('steps back from payBy in 23-hour steps, so it is always 31 min to 24 h ahead and never after payBy', () => {
    for (let ahead = 31 * min; ahead <= 72 * h; ahead += 17 * min) {
      const e = exp(ahead)! - now.getTime()
      expect(e).toBeGreaterThanOrEqual(31 * min)
      expect(e).toBeLessThan(24 * h)
      expect(e).toBeLessThanOrEqual(ahead)
      expect((ahead - e) % (23 * h)).toBe(0)
    }
  })
  it('is the same a few minutes later (a retry reuses the idempotency key with the same parameters)', () => {
    expect(exp(47 * h, new Date(now.getTime() + 5 * min))).toBe(exp(47 * h))
  })
  it('is null under 31 minutes before payBy (PAY_WINDOW_TOO_SHORT)', () => {
    expect(exp(31 * min - 1)).toBeUndefined()
    expect(exp(-min)).toBeUndefined()
  })
})
