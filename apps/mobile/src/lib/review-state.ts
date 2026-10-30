import type { Review } from '@kando/contract'

export type ReviewView = { mine: Review | null; theirs: Review | null; canWrite: boolean; canEdit: boolean }

const reached = (iso: string | null, now: Date) => iso !== null && new Date(iso).getTime() <= now.getTime()

/**
 * The reviews of one booking as this person may see them. Reviews are blind: the other side's review shows only once it is
 * visible (both are in, or the 7 days ran out); the server already holds it back, this is a second guard. My own review can
 * be changed until `editableUntil` (when it is shown), unless staff hid it. Whether writing is still open is the server's
 * call (7 days after completion: REVIEW_CLOSED).
 */
export function reviewView(reviews: Review[], bookingId: string, now = new Date()): ReviewView {
  const own = reviews.filter((r) => r.bookingId === bookingId)
  const mine = own.find((r) => r.mine) ?? null
  const other = own.find((r) => !r.mine) ?? null
  const theirs = other && !other.hidden && reached(other.visibleAt, now) ? other : null
  const canEdit = !!mine && !mine.hidden && mine.editableUntil !== null && !reached(mine.editableUntil, now)
  return { mine, theirs, canWrite: !mine, canEdit }
}
