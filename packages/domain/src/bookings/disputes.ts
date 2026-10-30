import { and, eq, isNull } from 'drizzle-orm'
import { bookings, db, disputes, providers, type Tx } from '@kando/db'
import type { Dispute, DisputeInput } from '@kando/contract'
import type { AfterCommit } from '../app-request'
import { assertNoContactDetails } from '../chat/flags'
import type { Exec } from '../providers/eligibility'
import { fail } from '../providers/http'
import { addWorkingDays, DISPUTE_DECISION_WORKING_DAYS } from './ending-rules'
import { parentNoShow } from './additional'
import { lockRow, sideOf } from './finish'
import { notifyBookingEvent } from './notify'

export type DisputeReason = 'problem' | 'no-show-objection' | 'no-response' | 'stop-disagreed' | 'chargeback'
type DisputeRow = typeof disputes.$inferSelect
type Row = typeof bookings.$inferSelect

/** Who decided is staff-internal and never shown. */
export const toDispute = (d: DisputeRow): Dispute => ({
  id: d.id,
  bookingId: d.bookingId,
  openedBy: d.openedBy as Dispute['openedBy'],
  reason: d.reason as Dispute['reason'],
  description: d.description,
  createdAt: d.createdAt.toISOString(),
  decideBy: d.decideBy.toISOString(),
  decision: d.decision as Dispute['decision'],
  providerShare: d.providerShare === null ? null : Number(d.providerShare),
  decisionReason: d.decisionReason,
  decidedAt: d.decidedAt ? d.decidedAt.toISOString() : null,
})

/**
 * The shared core of every dispute: one dispute row (one per booking: a second is 409 DISPUTE_EXISTS) with staff's
 * deadline `decideBy = now + 14 working days`, and the booking moves to `disputed`. Moves no money: settle refuses while
 * the dispute is undecided, and the timers leave the booking alone. The caller has locked and checked the booking row
 * on this owner-connection transaction `o`; `openedBy` null = the system. The caller tells both sides after the commit
 * (tellDisputeOpened). Staff see it in their disputes queue (deadline first) and may read the chat (staffMayReadThread).
 */
export async function openDisputeCore(
  o: Exec,
  d: { bookingId: string; openedBy: 'customer' | 'provider' | null; reason: DisputeReason; description: string; now: Date },
): Promise<DisputeRow> {
  const [row] = await o
    .insert(disputes)
    .values({ bookingId: d.bookingId, openedBy: d.openedBy, reason: d.reason, description: d.description, createdAt: d.now, decideBy: addWorkingDays(d.now, DISPUTE_DECISION_WORKING_DAYS) })
    .onConflictDoNothing({ target: disputes.bookingId })
    .returning()
  if (!row) return fail(409, { error: 'DISPUTE_EXISTS' })
  await o.update(bookings).set({ status: 'disputed', updatedAt: d.now }).where(eq(bookings.id, d.bookingId))
  return row
}

/** `dispute-opened` to the customer and the provider's owner (no description in the email; the app shows it). Never throws. */
export async function tellDisputeOpened(b: Pick<Row, 'id' | 'customerId' | 'providerId'>): Promise<void> {
  const owner = (await db.select({ id: providers.ownerId }).from(providers).where(eq(providers.id, b.providerId)).catch(() => []))[0]?.id
  for (const u of [b.customerId, owner]) if (u) await notifyBookingEvent('dispute-opened', u, { bookingId: b.id })
}

/** The statuses a system dispute may come from: the money is still held for an open job. */
const SYSTEM_FROM = ['confirmed', 'finished', 'stopped']

/**
 * A dispute raised by the system (`opened_by` null): the provider who never acted (no-response, timers.ts), a stop whose
 * amount stayed unanswered (no-response, timers.ts stopsToStaff), and a card chargeback while the money is not yet released
 * (payments/webhook.ts). Owner connection; locks the booking row and re-checks under the lock: only from an open job
 * (SYSTEM_FROM), money not released, no no-show report open on it or its root, no dispute yet, and `when` (the rule's
 * own condition) still true; otherwise null and
 * nothing changes (so a racing confirm, answer or second event finds it moved and nothing doubles). Both sides are told
 * through `afterCommit` (default: at once, for a caller whose `exec` commits here; the webhook passes its own).
 */
export async function openSystemDispute(
  exec: Exec,
  bookingId: string,
  reason: Extract<DisputeReason, 'no-response' | 'chargeback'>,
  now: Date,
  opts: { when?: (b: Row) => boolean; afterCommit?: AfterCommit } = {},
): Promise<DisputeRow | null> {
  const r = await exec.transaction(async (o) => {
    const [b] = await o.select().from(bookings).where(eq(bookings.id, bookingId)).for('update')
    if (!b || !SYSTEM_FROM.includes(b.status) || b.releasedAt || (opts.when && !opts.when(b))) return null
    // a no-show report still open (its own or its root's) ends its own way (48 hours or the objection's decision); a
    // dispute now would strand it and its covered additional tasks. The caller's staff flag (a chargeback) freezes settle.
    if (b.noShow || (await parentNoShow(o, b))) return null
    if ((await o.select({ id: disputes.id }).from(disputes).where(eq(disputes.bookingId, b.id))).length) return null
    return { b, d: await openDisputeCore(o, { bookingId: b.id, openedBy: null, reason, description: '', now }) }
  })
  if (!r) return null
  const tell = () => tellDisputeOpened(r.b)
  if (opts.afterCommit) opts.afterCommit(tell)
  else await tell()
  return r.d
}

/**
 * Either side reports a problem: from `finished` until `confirmBy` (after: 409 DISPUTE_CLOSED, the payment is due); from
 * `stopped` while no amount is agreed (`confirmBy` null; once agreed the payment is due: 409 not-open); the customer also
 * from `confirmed` once they were asked "Was the job done?" (the provider never tapped Finished; a reported no-show ends
 * its own way). Anything else is 409 not-open, a third person 404. The description (no contact details, 422) is shown to
 * the other side. Status `disputed`, `decideBy = now + 14 working days`; the money freezes until staff decide. Both sides
 * are told. On a `disputed` booking the caller's own undecided problem report is returned (a second tap); any other
 * dispute (the other side's, or another kind) is 409 DISPUTE_EXISTS. Owner connection, the row locked and re-checked, so
 * a racing automatic release has exactly one outcome: the release (completed, the dispute 409 not-open) or the dispute
 * (the release refused: not-open / DISPUTE_OPEN, nothing moves). Allowed while suspended (the route): it is about money paid.
 */
export async function openDispute(tx: Tx, userId: string, bookingId: string, input: DisputeInput, now = new Date()): Promise<Dispute> {
  const side = await sideOf(tx, userId, bookingId)
  await assertNoContactDetails(userId, input.description)
  const r = await db.transaction(async (o) => {
    const b = await lockRow(o, bookingId)
    if (b.status === 'disputed') {
      const [own] = await o.select().from(disputes).where(and(eq(disputes.bookingId, b.id), eq(disputes.openedBy, side), eq(disputes.reason, 'problem'), isNull(disputes.decidedAt)))
      return own ? { d: own, b: null } : fail(409, { error: 'DISPUTE_EXISTS' })
    }
    const asked = side === 'customer' && b.status === 'confirmed' && b.askedDoneAt !== null && !b.noShow
    const stoppedUnagreed = b.status === 'stopped' && b.confirmBy === null
    if (b.status !== 'finished' && !stoppedUnagreed && !asked) fail(409, { error: 'not-open' })
    if (b.status === 'finished' && b.confirmBy && b.confirmBy <= now) fail(409, { error: 'DISPUTE_CLOSED' })
    return { d: await openDisputeCore(o, { bookingId: b.id, openedBy: side, reason: 'problem', description: input.description, now }), b }
  })
  if (r.b) await tellDisputeOpened(r.b)
  return toDispute(r.d)
}

/** The dispute of a booking, for its two parties (RLS on the request transaction: a third person gets 404, as without one). */
export async function getDispute(tx: Tx, userId: string, bookingId: string): Promise<Dispute> {
  await sideOf(tx, userId, bookingId)
  const [d] = await tx.select().from(disputes).where(eq(disputes.bookingId, bookingId))
  return d ? toDispute(d) : fail(404, { error: 'Not found' })
}
