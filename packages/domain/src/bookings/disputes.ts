import { eq } from 'drizzle-orm'
import { bookings, disputes } from '@kando/db'
import type { Exec } from '../providers/eligibility'
import { fail } from '../providers/http'
import { addWorkingDays, DISPUTE_DECISION_WORKING_DAYS } from './ending-rules'

export type DisputeReason = 'problem' | 'no-show-objection' | 'no-response' | 'stop-disagreed' | 'chargeback'

/**
 * The shared core of every dispute (Task 5 builds openDispute and openSystemDispute on it): one dispute row (one per
 * booking: a second is 409 DISPUTE_EXISTS) with staff's deadline `decideBy = now + 14 working days`, and the booking moves
 * to `disputed`. Moves no money: settle refuses while the dispute is undecided. The caller has locked and checked the
 * booking row on this owner-connection transaction `o`; `openedBy` null = the system.
 */
export async function openDisputeCore(
  o: Exec,
  d: { bookingId: string; openedBy: 'customer' | 'provider' | null; reason: DisputeReason; description: string; now: Date },
): Promise<typeof disputes.$inferSelect> {
  const [row] = await o
    .insert(disputes)
    .values({ bookingId: d.bookingId, openedBy: d.openedBy, reason: d.reason, description: d.description, createdAt: d.now, decideBy: addWorkingDays(d.now, DISPUTE_DECISION_WORKING_DAYS) })
    .onConflictDoNothing({ target: disputes.bookingId })
    .returning()
  if (!row) return fail(409, { error: 'DISPUTE_EXISTS' })
  await o.update(bookings).set({ status: 'disputed', updatedAt: d.now }).where(eq(bookings.id, d.bookingId))
  return row
}
