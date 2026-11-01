import { describe, expect, it } from 'vitest'

import { assertFuture, bookingShownStatus, canTransition, mayPropose, overlaps, payBy } from './rules'
import { PAY_GRACE_MINUTES } from '../payments/rules'

const d = (s: string) => new Date(`2026-11-${s}:00.000Z`)

describe('bookingShownStatus', () => {
  const now = d('10T12:00')
  const min = (m: number) => new Date(now.getTime() + m * 60_000)
  it('proposed past answerBy', () => {
    expect(bookingShownStatus({ status: 'proposed', answerBy: now, payBy: null }, now)).toBe('expired')
    expect(bookingShownStatus({ status: 'proposed', answerBy: min(1), payBy: null }, now)).toBe('proposed')
  })
  it('awaiting-payment past payBy plus grace', () => {
    expect(bookingShownStatus({ status: 'awaiting-payment', answerBy: null, payBy: min(-PAY_GRACE_MINUTES) }, now)).toBe('expired')
  })
  it('inside the grace', () => {
    expect(bookingShownStatus({ status: 'awaiting-payment', answerBy: null, payBy: min(-PAY_GRACE_MINUTES + 1) }, now)).toBe('awaiting-payment')
  })
  it('other statuses unchanged', () => {
    for (const status of ['confirmed', 'declined', 'withdrawn', 'expired']) expect(bookingShownStatus({ status, answerBy: min(-60), payBy: min(-60) }, now)).toBe(status)
  })
})

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
  it('never falls after the start: 2h away gives the start, not +6h', () => {
    expect(payBy(d('02T10:00'), d('02T12:00'))).toEqual(d('02T12:00'))
    expect(payBy(d('02T10:00'), d('02T15:00'))).toEqual(d('02T15:00'))
    expect(payBy(d('02T10:00'), d('02T16:00'))).toEqual(d('02T16:00'))
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
  const all = ['proposed', 'awaiting-payment', 'confirmed', 'expired', 'declined', 'withdrawn', 'finished', 'completed', 'disputed', 'cancelled', 'stopped', 'refunded'] as const
  const allowed = new Set([
    'proposed>proposed',
    'proposed>awaiting-payment',
    'proposed>expired',
    'proposed>declined',
    'proposed>withdrawn',
    'awaiting-payment>expired',
    'awaiting-payment>withdrawn',
    'awaiting-payment>confirmed', // the payment webhook (owner connection)
    // endings: owner connection only (trigger bookings_guard_status); the table documents them
    ...['finished', 'cancelled', 'stopped', 'disputed', 'completed'].map((t) => `confirmed>${t}`),
    'finished>completed',
    'finished>disputed', // finished>stopped is deliberately absent
    'stopped>completed',
    'stopped>disputed',
    // a staff refund of the whole amount (admin/bookings.ts staffRefund)
    'confirmed>refunded',
    'finished>refunded',
    'stopped>refunded',
    'disputed>completed',
    'disputed>refunded',
    'disputed>cancelled',
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

describe('flow 1: the proposal round rule', () => {
  const mine = { side: 'provider' as const, customerProposals: 1, providerProposals: 0, otherWroteSinceMine: false }
  it('the first proposal each way is free (the request is the customer\'s first)', () => {
    expect(mayPropose({ ...mine, side: 'provider' })).toEqual({ ok: true })
    expect(mayPropose({ ...mine, side: 'customer', customerProposals: 1, providerProposals: 1 })).toEqual({ ok: false, reason: 'chat-first' })
  })
  it('a customer changing the time before the provider proposed anything is not looping', () => {
    expect(mayPropose({ side: 'customer', customerProposals: 3, providerProposals: 0, otherWroteSinceMine: false })).toEqual({ ok: true })
  })
  it('a side that already proposed needs the other side to have written since', () => {
    expect(mayPropose({ ...mine, providerProposals: 1 })).toEqual({ ok: false, reason: 'chat-first' })
    expect(mayPropose({ ...mine, providerProposals: 1, otherWroteSinceMine: true })).toEqual({ ok: true })
    expect(mayPropose({ side: 'customer', customerProposals: 2, providerProposals: 1, otherWroteSinceMine: true })).toEqual({ ok: true })
  })
})

describe('flow 1: an awaiting-time booking', () => {
  const now = d('10T12:00')
  it('shows expired once its answer-by has passed, and is not a proposal or payment state', () => {
    expect(bookingShownStatus({ status: 'awaiting-time', answerBy: now, payBy: null }, now)).toBe('expired')
    expect(bookingShownStatus({ status: 'awaiting-time', answerBy: new Date(now.getTime() + 60_000), payBy: null }, now)).toBe('awaiting-time')
  })
  it('moves to payment, expiry or withdrawal, never straight to paid', () => {
    expect(canTransition('awaiting-time', 'awaiting-payment')).toBe(true)
    expect(canTransition('awaiting-time', 'expired')).toBe(true)
    expect(canTransition('awaiting-time', 'withdrawn')).toBe(true)
    expect(canTransition('awaiting-time', 'confirmed')).toBe(false)
  })
})
