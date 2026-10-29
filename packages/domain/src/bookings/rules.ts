import type { BOOKING_STATUSES } from '@kando/contract'

import { fail } from '../providers/http'

type BookingStatus = (typeof BOOKING_STATUSES)[number]

export const REQUEST_ANSWER_DAYS = 3
export const QUOTE_VALID_DAYS = 7
export const PROPOSAL_ANSWER_HOURS = 24
export const BUFFER_MINUTES = 30
export const IGNORED_LIMIT = 3
export const IGNORED_WINDOW_DAYS = 30

export type Span = { start: Date; end: Date }

const HOUR = 3_600_000
const MAX_AHEAD_DAYS = 365

/** Payment deadline: 48h after acceptance but at least 24h before the start; under 24h to go, 6h. */
export const payBy = (acceptedAt: Date, startAt: Date): Date => {
  const a = acceptedAt.getTime()
  const s = startAt.getTime()
  if (s - a < 24 * HOUR) return new Date(a + 6 * HOUR)
  return new Date(Math.min(a + 48 * HOUR, s - 24 * HOUR))
}

/** True when the spans, each widened by the buffer, share time; touching at exactly the buffer is free. */
export const overlaps = (a: Span, b: Span, bufferMin: number): boolean => {
  const buf = bufferMin * 60_000
  return a.start.getTime() < b.end.getTime() + buf && b.start.getTime() < a.end.getTime() + buf
}

const TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  proposed: ['awaiting-payment', 'expired', 'declined', 'withdrawn', 'proposed'],
  'awaiting-payment': ['expired', 'withdrawn'],
  expired: [],
  declined: [],
  withdrawn: [],
}

export const canTransition = (from: BookingStatus, to: BookingStatus): boolean => TRANSITIONS[from].includes(to)

export const assertFuture = (startAt: Date, now: Date): void => {
  const t = startAt.getTime()
  if (t <= now.getTime()) fail(400, { error: 'start-in-past' })
  if (t > now.getTime() + MAX_AHEAD_DAYS * 24 * HOUR) fail(400, { error: 'start-too-far' })
}
