import { describe, expect, it } from 'vitest'

import { COMMISSION_RATE } from './payments'
import { commissionFor, customerCancelShare, isLate, lateCancelFee, roundMoney, toCents, youReceive } from './money'

describe('toCents', () => {
  it('is exact for amounts with up to 2 decimals', () => {
    expect(toCents(19.99)).toBe(1999)
    expect(toCents(1.005)).toBe(101) // half up after dropping binary noise
    expect(toCents(0.07)).toBe(7)
    expect(toCents(0)).toBe(0)
    expect(toCents(1_000_000.01)).toBe(100_000_001)
  })
  it('rejects NaN, infinity, negatives and amounts too big to be exact', () => {
    for (const bad of [NaN, Infinity, -Infinity, -0.01, Number.MAX_SAFE_INTEGER]) expect(() => toCents(bad)).toThrow(RangeError)
  })
})

describe('roundMoney', () => {
  it('rounds a sum to cents', () => expect(roundMoney(0.1 + 0.2)).toBe(0.3))
})

describe('commissionFor / youReceive at the platform rate', () => {
  it('rounds half up to cents', () => {
    expect(commissionFor(120, COMMISSION_RATE)).toBe(18)
    expect(commissionFor(33.33, COMMISSION_RATE)).toBe(5) // 4.9995 cents-wise: 499.95 -> 500
    expect(commissionFor(0.03, COMMISSION_RATE)).toBe(0) // 0.45 cent rounds down
    expect(commissionFor(0.04, COMMISSION_RATE)).toBe(0.01) // 0.6 cent rounds up
    expect(commissionFor(0, COMMISSION_RATE)).toBe(0)
  })
  it('the provider receives the rest', () => {
    expect(youReceive(120, COMMISSION_RATE)).toBe(102)
    expect(youReceive(33.33, COMMISSION_RATE)).toBe(28.33)
    expect(youReceive(0.03, COMMISSION_RATE)).toBe(0.03)
  })
  it('handles large amounts', () => expect(commissionFor(99_999.99, COMMISSION_RATE)).toBe(15_000))
  it('rejects a rate outside 0..1 and a bad amount', () => {
    expect(() => commissionFor(10, 1.5)).toThrow(RangeError)
    expect(() => commissionFor(10, NaN)).toThrow(RangeError)
    expect(() => commissionFor(-1, 0.15)).toThrow(RangeError)
  })
})

describe('late cancellation', () => {
  const start = new Date('2026-12-10T12:00:00Z')
  const ago = (ms: number) => new Date(start.getTime() - ms)
  const H = 3_600_000
  it('exactly 24 hours before the start is still free; one millisecond later is late', () => {
    expect(isLate(start, ago(24 * H))).toBe(false)
    expect(isLate(start, ago(24 * H - 1))).toBe(true)
    expect(isLate(start, ago(24 * H + 1))).toBe(false)
    expect(isLate(start, ago(-H))).toBe(true) // after the start
  })
  it('the fee is half, in whole cents, half up, never above the amount', () => {
    expect(lateCancelFee(100)).toBe(50)
    expect(lateCancelFee(33.33)).toBe(16.67)
    expect(lateCancelFee(0.03)).toBe(0.02)
    expect(lateCancelFee(0.01)).toBe(0.01) // 0.5 cent rounds up to 1, capped at the amount
    expect(lateCancelFee(0)).toBe(0)
    expect(lateCancelFee(1.005)).toBe(0.51)
  })
  it('the provider is paid nothing in time, the fee when late', () => {
    expect(customerCancelShare(80, start, ago(24 * H))).toBe(0)
    expect(customerCancelShare(80, start, ago(24 * H - 1))).toBe(40)
  })
})

describe('isLate without a start', () => {
  it('a null, undefined or invalid start is never late', () => {
    const now = new Date('2026-12-10T12:00:00Z')
    expect(isLate(null, now)).toBe(false)
    expect(isLate(undefined, now)).toBe(false)
    expect(isLate(new Date(NaN), now)).toBe(false)
  })
})

describe('same results as the formulas before the merge, for every 2-decimal amount 0.00 to 5000.00', () => {
  const oldCents12 = (x: number) => Math.round(Number((x * 100).toPrecision(12))) // the late-cancel copy
  const oldFee = (amount: number) => Math.min(oldCents12(amount), Math.round(oldCents12(amount) * 0.5)) / 100
  const oldPhoneFee = (amount: number) => Math.round(Math.round(amount * 100) * 0.5) / 100 // the phone copy
  const oldReceive = (v: number, rate: number) => Math.round((v - Math.round(Number((v * 100 * rate).toPrecision(15))) / 100) * 100) / 100 // the phone preview
  it('toCents, lateCancelFee and the preview agree', () => {
    const differ: number[] = []
    for (let c = 0; c <= 500_000; c++) {
      const a = c / 100
      if (toCents(a) !== c || lateCancelFee(a) !== oldFee(a) || lateCancelFee(a) !== oldPhoneFee(a) || youReceive(a, 0.15) !== oldReceive(a, 0.15)) differ.push(c)
    }
    expect(differ).toEqual([])
  }, 60_000)
})
