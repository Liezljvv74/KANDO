import { describe, expect, it } from 'vitest'

import { assertFuture, canTransition, overlaps, payBy } from './rules'

const d = (s: string) => new Date(`2026-11-${s}:00.000Z`)

describe('payBy', () => {
  it('is 48h after acceptance when start is far away', () => {
    expect(payBy(d('02T10:00'), d('06T10:00'))).toEqual(d('04T10:00'))
  })
  it('is start minus 24h when that is sooner than 48h after acceptance', () => {
    expect(payBy(d('02T10:00'), d('04T10:00'))).toEqual(d('03T10:00'))
  })
  it('is 6h after acceptance when start is under 24h away', () => {
    expect(payBy(d('02T10:00'), d('03T09:00'))).toEqual(d('02T16:00'))
  })
  it('is acceptance itself when start is exactly 24h away', () => {
    expect(payBy(d('02T10:00'), d('03T10:00'))).toEqual(d('02T10:00'))
  })
})

describe('overlaps', () => {
  const a = { start: d('02T10:00'), end: d('02T11:00') }
  it('counts the buffer', () => {
    expect(overlaps(a, { start: d('02T11:20'), end: d('02T12:00') }, 30)).toBe(true)
    expect(overlaps(a, { start: d('02T11:30'), end: d('02T12:00') }, 30)).toBe(false)
    expect(overlaps({ start: d('02T11:30'), end: d('02T12:00') }, a, 30)).toBe(false)
  })
  it('with no buffer only a real overlap counts', () => {
    expect(overlaps(a, { start: d('02T11:00'), end: d('02T12:00') }, 0)).toBe(false)
    expect(overlaps(a, { start: d('02T10:59'), end: d('02T12:00') }, 0)).toBe(true)
  })
})

describe('canTransition', () => {
  it('follows the allowed table', () => {
    expect(canTransition('proposed', 'awaiting-payment')).toBe(true)
    expect(canTransition('proposed', 'proposed')).toBe(true)
    expect(canTransition('awaiting-payment', 'expired')).toBe(true)
    expect(canTransition('expired', 'awaiting-payment')).toBe(false)
    expect(canTransition('awaiting-payment', 'proposed')).toBe(false)
  })
})

describe('assertFuture', () => {
  const now = d('02T10:00')
  const status = (f: () => void) => {
    try {
      f()
    } catch (e) {
      return (e as Response).status
    }
  }
  it('accepts a start within the next year and rejects past or too far', () => {
    expect(status(() => assertFuture(d('02T10:01'), now))).toBeUndefined()
    expect(status(() => assertFuture(d('02T10:00'), now))).toBe(400)
    expect(status(() => assertFuture(new Date(now.getTime() + 366 * 86_400_000), now))).toBe(400)
  })
})
