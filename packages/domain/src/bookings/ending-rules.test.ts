import { describe, expect, it } from 'vitest'

import { LATE_CANCEL_SHARE, NO_SHOW_OBJECTION_HOURS, STOP_ANSWER_DAYS } from '@kando/contract'
import {
  ADDITIONAL_PAY_HOURS,
  addWorkingDays,
  ASK_DONE_HOURS,
  canEditReview,
  CONFIRM_DAYS,
  CONFIRM_REMINDER_DAYS,
  customerCancelShare,
  DISPUTE_DECISION_WORKING_DAYS,
  dueConfirmReminder,
  endOf,
  isLate,
  NO_ACTION_STAFF_DAYS,
  REVIEW_EDIT_DAYS,
  REVIEW_VISIBLE_DAYS,
  reviewVisibleAt,
} from './ending-rules'

const H = 3_600_000
const D = 24 * H
const iso = (s: string) => new Date(s)

describe('constants', () => {
  it('match the plan', () => {
    expect([LATE_CANCEL_SHARE, NO_SHOW_OBJECTION_HOURS, DISPUTE_DECISION_WORKING_DAYS, STOP_ANSWER_DAYS, REVIEW_VISIBLE_DAYS, REVIEW_EDIT_DAYS]).toEqual([0.5, 48, 14, 7, 7, 14])
    expect([CONFIRM_DAYS, ASK_DONE_HOURS, NO_ACTION_STAFF_DAYS, ADDITIONAL_PAY_HOURS]).toEqual([7, 24, 7, 48])
    expect(CONFIRM_REMINDER_DAYS).toEqual([1, 3, 6])
  })
})

describe('endOf', () => {
  it('adds elapsed minutes', () => {
    expect(endOf({ startAt: iso('2026-11-02T10:00:00Z'), durationMin: 90 })).toEqual(iso('2026-11-02T11:30:00Z'))
  })
  it('counts real elapsed time across a DST change', () => {
    // Berlin 2027-03-28 01:00 CET (=00:00Z) plus 120 min is 04:00 CEST (=02:00Z)
    expect(endOf({ startAt: iso('2027-03-28T00:00:00Z'), durationMin: 120 })).toEqual(iso('2027-03-28T02:00:00Z'))
  })
  it('rejects zero, negative and non-finite durations', () => {
    for (const durationMin of [0, -5, NaN, Infinity]) expect(() => endOf({ startAt: new Date(), durationMin })).toThrow()
  })
})

describe('addWorkingDays', () => {
  it('Friday 10:00 plus 1 is Monday 10:00 (Berlin)', () => {
    expect(addWorkingDays(iso('2026-11-06T09:00:00Z'), 1)).toEqual(iso('2026-11-09T09:00:00Z'))
  })
  it('Monday 10:00 plus 14 is 18 calendar days later, a Friday', () => {
    const from = iso('2026-11-02T09:00:00Z')
    expect(addWorkingDays(from, 14)).toEqual(new Date(from.getTime() + 18 * D))
  })
  it('from a weekend, the first working day is the next Monday', () => {
    expect(addWorkingDays(iso('2026-11-07T09:00:00Z'), 1)).toEqual(iso('2026-11-09T09:00:00Z'))
    expect(addWorkingDays(iso('2026-11-08T09:00:00Z'), 1)).toEqual(iso('2026-11-09T09:00:00Z'))
  })
  it('zero days returns the same instant', () => {
    expect(addWorkingDays(iso('2026-11-06T09:00:00Z'), 0)).toEqual(iso('2026-11-06T09:00:00Z'))
  })
  it('keeps the Berlin wall clock across the spring change (2027-03-28)', () => {
    // Friday 2027-03-26 10:00 CET (09:00Z) + 1 working day = Monday 2027-03-29 10:00 CEST (08:00Z)
    expect(addWorkingDays(iso('2027-03-26T09:00:00Z'), 1)).toEqual(iso('2027-03-29T08:00:00Z'))
  })
  it('keeps the Berlin wall clock across the autumn change (2026-10-25)', () => {
    // Friday 2026-10-23 10:00 CEST (08:00Z) + 1 = Monday 2026-10-26 10:00 CET (09:00Z)
    expect(addWorkingDays(iso('2026-10-23T08:00:00Z'), 1)).toEqual(iso('2026-10-26T09:00:00Z'))
  })
  it('uses the Berlin date near midnight, not the UTC date', () => {
    // Friday 23:30 Berlin = 22:30Z Friday; +1 working day is Monday 23:30 Berlin
    expect(addWorkingDays(iso('2026-11-06T22:30:00Z'), 1)).toEqual(iso('2026-11-09T22:30:00Z'))
    // Friday 23:30Z is already Saturday 00:30 in Berlin, so +1 is Monday 00:30 Berlin (Sunday 23:30Z)
    expect(addWorkingDays(iso('2026-11-06T23:30:00Z'), 1)).toEqual(iso('2026-11-08T23:30:00Z'))
  })
  it('a 14 working day range across the spring change lands on the same wall clock', () => {
    // Monday 2027-03-22 10:00 CET (09:00Z) + 14 = Friday 2027-04-09 10:00 CEST (08:00Z)
    expect(addWorkingDays(iso('2027-03-22T09:00:00Z'), 14)).toEqual(iso('2027-04-09T08:00:00Z'))
  })
  it('rejects negative or fractional days', () => {
    expect(() => addWorkingDays(new Date(), -1)).toThrow()
    expect(() => addWorkingDays(new Date(), 1.5)).toThrow()
  })
})

describe('isLate and customerCancelShare', () => {
  const start = iso('2026-11-10T10:00:00Z')
  const at = (ms: number) => new Date(start.getTime() + ms)
  it('exactly 24h before the start is still free; one millisecond later is late', () => {
    expect(isLate(start, at(-24 * H))).toBe(false)
    expect(isLate(start, at(-24 * H + 1))).toBe(true)
    expect(isLate(start, at(-24 * H - 1))).toBe(false)
  })
  it('pays 0 at 24h, 50% at 23h59m', () => {
    expect(customerCancelShare(100, start, at(-24 * H))).toBe(0)
    expect(customerCancelShare(100, start, at(-24 * H + 60_000))).toBe(50)
  })
  it('rounds to cents, half up, never above the amount', () => {
    const late = at(-H)
    expect(customerCancelShare(33.33, start, late)).toBe(16.67)
    expect(customerCancelShare(0.01, start, late)).toBe(0.01)
    expect(customerCancelShare(0.03, start, late)).toBe(0.02)
    expect(customerCancelShare(1.01, start, late)).toBe(0.51)
    for (const a of [0, 0.01, 0.02, 9.99, 33.33, 1234.57]) expect(customerCancelShare(a, start, late)).toBeLessThanOrEqual(a)
  })
  it('after the start it is still the late share (the caller decides cancel vs no-show)', () => {
    expect(customerCancelShare(100, start, at(H))).toBe(50)
  })
})

describe('dueConfirmReminder', () => {
  const f = iso('2026-11-02T10:00:00Z')
  const at = (ms: number) => new Date(f.getTime() + ms)
  it('first reminder after 1 day', () => {
    expect(dueConfirmReminder(f, 0, at(D - 1))).toBe(false)
    expect(dueConfirmReminder(f, 0, at(D))).toBe(true)
  })
  it('second after 3 days, third after 6, then none', () => {
    expect(dueConfirmReminder(f, 1, at(2 * D))).toBe(false)
    expect(dueConfirmReminder(f, 1, at(3 * D))).toBe(true)
    expect(dueConfirmReminder(f, 2, at(5 * D))).toBe(false)
    expect(dueConfirmReminder(f, 2, at(6 * D))).toBe(true)
    expect(dueConfirmReminder(f, 3, at(7 * D))).toBe(false)
  })
  it('a late run: one reminder per run, the next index stays due until sent', () => {
    // cron was down until day 6.5 with nothing sent: three runs, three reminders, none skipped
    const now = at(6.5 * D)
    expect([0, 1, 2].map((sent) => dueConfirmReminder(f, sent, now))).toEqual([true, true, true])
    expect(dueConfirmReminder(f, 3, now)).toBe(false)
  })
  it('a negative sent count is never due', () => {
    expect(dueConfirmReminder(f, -1, at(9 * D))).toBe(false)
  })
})

describe('reviews', () => {
  const c = iso('2026-11-02T10:00:00Z')
  it('both in: visible now', () => {
    const now = new Date(c.getTime() + D)
    expect(reviewVisibleAt(c, true, now)).toEqual(now)
  })
  it('only one in: visible 7 days after completion', () => {
    expect(reviewVisibleAt(c, false, new Date(c.getTime() + D))).toEqual(new Date(c.getTime() + 7 * D))
  })
  it('only one in and 7 days passed: the 7-day mark (already in the past)', () => {
    expect(reviewVisibleAt(c, false, new Date(c.getTime() + 8 * D))).toEqual(new Date(c.getTime() + 7 * D))
  })
  it('the author may edit until it is shown or 14 days passed, whichever first', () => {
    // not shown yet (no reveal time): the 14 days bound
    expect(canEditReview(c, null, new Date(c.getTime() + 14 * D - 1))).toBe(true)
    expect(canEditReview(c, null, new Date(c.getTime() + 14 * D))).toBe(false)
    // shown on day 3 (both in): final from that moment
    const shown = new Date(c.getTime() + 3 * D)
    expect(canEditReview(c, shown, new Date(shown.getTime() - 1))).toBe(true)
    expect(canEditReview(c, shown, shown)).toBe(false)
    // a reveal after the 14 days: the 14 days still end it
    expect(canEditReview(c, new Date(c.getTime() + 20 * D), new Date(c.getTime() + 14 * D))).toBe(false)
  })
})

describe('late cancellation, hard-coded numbers', () => {
  const start = iso('2027-01-05T12:00:00.000Z')
  it('exactly 24 h before is free, one minute inside is late', () => {
    expect(isLate(start, new Date(start.getTime() - 24 * H))).toBe(false)
    expect(isLate(start, new Date(start.getTime() - 24 * H + 60_000))).toBe(true)
    expect(customerCancelShare(100, start, new Date(start.getTime() - 24 * H))).toBe(0)
    expect(customerCancelShare(100, start, new Date(start.getTime() - 24 * H + 60_000))).toBe(50)
  })
  it('33.33 rounds from cents to 16.67', () => {
    expect(customerCancelShare(33.33, start, new Date(start.getTime() - H))).toBe(16.67)
  })
})
