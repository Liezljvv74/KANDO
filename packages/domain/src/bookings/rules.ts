import { HOUR, type BOOKING_STATUSES } from '@kando/contract'

import { MAX_PAY_AHEAD_DAYS, PAY_GRACE_MINUTES, paymentsEnabled } from '../payments/rules'
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
/** A side that already proposed this many times needs the other side to have written in the chat before it proposes again (the request is the customer's first). */
export const PROPOSALS_BEFORE_CHAT = 1
/** Days a booking may wait in awaiting-time (a quote accepted without a time) for both sides to agree it. */
export const AWAITING_TIME_DAYS = 7
/** Hours the other side has to confirm a time that was entered after the quote was accepted. */
export const TIME_ANSWER_HOURS = 48

export type Span = { start: Date; end: Date }

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
  // a quote accepted without a time: no slot, no money until both sides agree the time (flow 1)
  'awaiting-time': ['awaiting-payment', 'expired', 'withdrawn'],
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

/**
 * The status a read shows: a lapsed proposal or unpaid booking (the same deadlines as the cron's expiry, timers.ts) shows
 * `expired` before the daily cron writes it. Reads never write; the stored row changes in the cron and the write paths.
 */
export const bookingShownStatus = (b: { status: string; answerBy: Date | null; payBy: Date | null }, now: Date): string => {
  if (b.status === 'proposed' && b.answerBy && b.answerBy <= now) return 'expired'
  if (b.status === 'awaiting-time' && b.answerBy && b.answerBy <= now) return 'expired'
  if (b.status === 'awaiting-payment' && b.payBy && b.payBy.getTime() + PAY_GRACE_MINUTES * 60_000 <= now.getTime()) return 'expired'
  return b.status
}

/**
 * Whether a side may propose a (different) time now. Free until each side has proposed once (the request is the customer's
 * first); from then on the other side must have written in the chat since this side's last proposal, so the two talk before the
 * loop goes on (flow 1). A customer who changes the time before the provider has proposed anything is not looping.
 */
export const mayPropose = (a: { side: 'customer' | 'provider'; customerProposals: number; providerProposals: number; otherWroteSinceMine: boolean }): { ok: true } | { ok: false; reason: 'chat-first' } => {
  const mine = a.side === 'customer' ? a.customerProposals : a.providerProposals
  const theirs = a.side === 'customer' ? a.providerProposals : a.customerProposals
  return mine < PROPOSALS_BEFORE_CHAT || theirs < PROPOSALS_BEFORE_CHAT || a.otherWroteSinceMine ? { ok: true } : { ok: false, reason: 'chat-first' }
}

export const canTransition = (from: BookingStatus, to: BookingStatus): boolean => TRANSITIONS[from].includes(to)

export const assertFuture = (startAt: Date, now: Date): void => {
  const t = startAt.getTime()
  if (t <= now.getTime()) fail(400, { error: 'start-in-past' })
  if (t > now.getTime() + MAX_AHEAD_DAYS * 24 * HOUR) fail(400, { error: 'start-too-far' })
  // with payments on, a time must be payable: the money can be held only so long (payments/rules.ts)
  if (paymentsEnabled() && t > now.getTime() + MAX_PAY_AHEAD_DAYS * 24 * HOUR) fail(400, { error: 'TOO_FAR_AHEAD' })
}
