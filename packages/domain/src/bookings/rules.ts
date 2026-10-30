import type { BOOKING_STATUSES } from '@kando/contract'

import { MAX_PAY_AHEAD_DAYS, paymentsEnabled } from '../payments/rules'
import { fail } from '../providers/http'

type BookingStatus = (typeof BOOKING_STATUSES)[number]

export const REQUEST_ANSWER_DAYS = 3
export const QUOTE_VALID_DAYS = 7
export const PROPOSAL_ANSWER_HOURS = 24
export const BUFFER_MINUTES = 30
export const IGNORED_LIMIT = 3
export const IGNORED_WINDOW_DAYS = 30
/** Days after a requests-ignored notice until a provider still silent is flagged to staff (timers.ts). */
export const IGNORED_FLAG_DAYS = 14
export const PAY_WINDOW_HOURS = 48
export const PAY_BEFORE_START_HOURS = 24
export const SHORT_NOTICE_PAY_HOURS = 6
export const SHORT_NOTICE_THRESHOLD_HOURS = 24
export const MAX_OPEN_REQUESTS_PER_PAIR = 1
export const MAX_REQUESTS_PER_DAY = 10

export type Span = { start: Date; end: Date }

const HOUR = 3_600_000
const MAX_AHEAD_DAYS = 365

/** Payment deadline: 48h after acceptance but at least 24h before the start; 24h or less to go, 6h. */
export const payBy = (acceptedAt: Date, startAt: Date): Date => {
  const a = acceptedAt.getTime()
  const s = startAt.getTime()
  if (s - a <= SHORT_NOTICE_THRESHOLD_HOURS * HOUR) return new Date(Math.min(a + SHORT_NOTICE_PAY_HOURS * HOUR, s)) // never after the start
  return new Date(Math.min(a + PAY_WINDOW_HOURS * HOUR, s - PAY_BEFORE_START_HOURS * HOUR))
}

/** True when the spans, each widened by the buffer, share time; touching at exactly the buffer is free. */
export const overlaps = (a: Span, b: Span, bufferMin: number): boolean => {
  const buf = bufferMin * 60_000
  return a.start.getTime() < b.end.getTime() + buf && b.start.getTime() < a.end.getTime() + buf
}

const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  proposed: ['awaiting-payment', 'expired', 'declined', 'withdrawn', 'proposed'],
  // -> confirmed only by the payment webhook on the owner connection (trigger bookings_guard_status); plan 2d adds the ways out of confirmed
  'awaiting-payment': ['expired', 'withdrawn', 'confirmed'],
  // A paid booking and its endings move only on the owner connection (OWNER_ONLY_BOOKING_STATUSES, trigger
  // bookings_guard_status), after the domain checked the caller. The transitions below are owner-connection
  // only: the database trigger stops app_user from making them, and no app route calls canTransition with them.
  // -> refunded: a staff refund of the whole amount (admin/bookings.ts staffRefund)
  confirmed: ['finished', 'cancelled', 'stopped', 'disputed', 'completed', 'refunded'],
  expired: [],
  declined: [],
  withdrawn: [],
  finished: ['completed', 'disputed', 'refunded'],
  completed: [],
  disputed: ['completed', 'refunded', 'cancelled'],
  cancelled: [],
  stopped: ['completed', 'disputed', 'refunded'],
  refunded: [],
}

export const canTransition = (from: BookingStatus, to: BookingStatus): boolean => TRANSITIONS[from].includes(to)

export const assertFuture = (startAt: Date, now: Date): void => {
  const t = startAt.getTime()
  if (t <= now.getTime()) fail(400, { error: 'start-in-past' })
  if (t > now.getTime() + MAX_AHEAD_DAYS * 24 * HOUR) fail(400, { error: 'start-too-far' })
  // with payments on, a time must be payable: the money can be held only so long (payments/rules.ts)
  if (paymentsEnabled() && t > now.getTime() + MAX_PAY_AHEAD_DAYS * 24 * HOUR) fail(400, { error: 'TOO_FAR_AHEAD' })
}
