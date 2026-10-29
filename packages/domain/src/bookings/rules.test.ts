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
  it('is 6h after acceptance when start is exactly 24h away', () => {
    expect(payBy(d('02T10:00'), d('03T10:00'))).toEqual(d('02T16:00'))
  })
  it('is the same instant at exactly 48h away, and follows each side of it', () => {
    const a = d('02T10:00')
    const at = (h: number) => new Date(a.getTime() + h * 3_600_000)
    expect(payBy(a, at(48))).toEqual(at(24)) // a+48h equals s-24h
    expect(payBy(a, at(49))).toEqual(at(25))
    expect(payBy(a, at(47))).toEqual(at(23))
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
  const all = ['proposed', 'awaiting-payment', 'expired', 'declined', 'withdrawn'] as const
  const allowed = new Set([
    'proposed>proposed',
    'proposed>awaiting-payment',
    'proposed>expired',
    'proposed>declined',
    'proposed>withdrawn',
    'awaiting-payment>expired',
    'awaiting-payment>withdrawn',
  ])
  it('allows exactly the table, nothing leaves a final state', () => {
    for (const from of all) for (const to of all) expect(canTransition(from, to), `${from}>${to}`).toBe(allowed.has(`${from}>${to}`))
  })
})

describe('assertFuture', () => {
  const now = d('02T10:00')
  const caught = (start: Date) => {
    try {
      assertFuture(start, now)
    } catch (e) {
      return e as Response
    }
    return undefined
  }
  const failure = async (start: Date) => {
    const r = caught(start)
    if (!r) throw new Error('expected assertFuture to throw')
    return { status: r.status, body: await r.json() }
  }
  const year = 365 * 86_400_000
  it('accepts a start after now up to 365 days ahead', () => {
    expect(caught(d('02T10:01'))).toBeUndefined()
    expect(caught(new Date(now.getTime() + year))).toBeUndefined()
  })
  it('rejects the past and now', async () => {
    expect(await failure(d('02T10:00'))).toEqual({ status: 400, body: { error: 'start-in-past' } })
    expect(await failure(d('01T10:00'))).toEqual({ status: 400, body: { error: 'start-in-past' } })
  })
  it('rejects more than 365 days ahead', async () => {
    expect(await failure(new Date(now.getTime() + year + 1))).toEqual({ status: 400, body: { error: 'start-too-far' } })
  })
})
