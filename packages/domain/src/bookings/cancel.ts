import { and, eq, inArray, sql } from 'drizzle-orm'
import { bookings, db, disputes, providers, type Tx } from '@kando/db'
import type { Booking, NoShowObjection } from '@kando/contract'
import { assertNoContactDetails, flagForStaff } from '../chat/flags'
import { describeError } from '../log-error'
import type { Exec } from '../providers/eligibility'
import { fail } from '../providers/http'
import { toCents } from '../payments/rules'
import { settle } from '../payments/settle'
import { openDisputeCore } from './disputes'
import { customerCancelShare, isLate, NO_SHOW_OBJECTION_HOURS } from './ending-rules'
import { attemptMoney, lockRow, reload, sideOf } from './finish'
import { notifyBookingEvent } from './notify'

type Row = typeof bookings.$inferSelect
type Side = 'customer' | 'provider'
const HOUR = 3_600_000
const otherSide = (s: Side): Side => (s === 'customer' ? 'provider' : 'customer')
const ownerOf = async (providerId: string) => (await db.select({ id: providers.ownerId }).from(providers).where(eq(providers.id, providerId)))[0]?.id
const objectBy = (b: Row) => new Date(b.noShowReportedAt!.getTime() + NO_SHOW_OBJECTION_HOURS * HOUR)

/**
 * What the customer paid, in cents, with this settlement's own refund still counted as paid (settle does the same): the
 * base of every cancellation share, so a retry after a partly done settle computes the same split.
 */
async function chargedCents(o: Exec, id: string): Promise<number> {
  const r = await o.execute<{ c: string }>(sql`
    SELECT coalesce(sum(CASE WHEN kind = 'charge' THEN amount WHEN kind = 'refund' AND idempotency_key <> ${`refund:${id}`} THEN -amount ELSE 0 END), 0)::text AS c
    FROM ledger_entries WHERE booking_id = ${id}`)
  return toCents(Number(r.rows[0]!.c))
}

/**
 * The provider's share of a cancelled booking, from the stored facts only (a retry pays the same split): a customer no-show
 * pays everything; a provider no-show or a provider cancellation nothing (full refund; KANDO absorbs the processing fee);
 * a customer cancellation nothing up to 24 hours before the start, else LATE_CANCEL_SHARE of what was paid.
 */
async function cancelShare(o: Exec, b: Row): Promise<number> {
  const paid = (await chargedCents(o, b.id)) / 100
  if (b.noShow === 'customer') return paid
  if (b.noShow === 'provider' || b.cancelledBy === 'provider') return 0
  return customerCancelShare(paid, b.startAt, b.cancelledAt!)
}

/**
 * Settles a cancelled, paid booking with its share (owner connection; the row locked; quiet once settled or unpaid).
 * Refusals pass through (DISPUTE_OPEN, NO_PAYOUT_ACCOUNT ...); the timers retry them (timers.ts releaseDue).
 */
export async function settleCancelled(exec: Exec, bookingId: string): Promise<void> {
  await exec.transaction(async (o) => {
    const b = await lockRow(o, bookingId)
    if (b.status !== 'cancelled') fail(409, { error: 'not-open' })
    if (!b.paidAt || b.releasedAt) return
    await settle(o, b.id, await cancelShare(o, b))
  })
}

/** settleCancelled that never throws (attemptMoney: logged, flagged to staff once, retried by the timer). */
export const trySettleCancelled = (bookingId: string, customerId: string, now: Date): Promise<boolean> =>
  attemptMoney('cancel', bookingId, customerId, now, () => settleCancelled(db, bookingId))

/** Tells the other side that a booking was cancelled, with who did it and what happens to the money (no amounts or dates). */
async function tellCancelled(b: Row): Promise<void> {
  const [to, variant] =
    b.noShow === 'customer' ? (['provider', 'no-show-customer'] as const)
    : b.noShow === 'provider' ? (['customer', 'no-show-provider'] as const)
    : b.cancelledBy === 'provider' ? (['customer', 'by-provider'] as const)
    : (['provider', b.lateCancel ? 'late' : ''] as const)
  const userId = to === 'customer' ? b.customerId : await ownerOf(b.providerId)
  if (userId) await notifyBookingEvent('booking-cancelled', userId, { bookingId: b.id, ...(variant && { variant }) })
}

/**
 * Either side cancels a `confirmed` booking before its start (after it: 409 STARTED, the job is stopped or a no-show
 * reported instead; an unpaid booking is withdrawn, plan 2a). Status `cancelled`, `cancelledBy`, `lateCancel` (less than
 * 24 hours to go). Money (settle, through cancelShare): the customer cancelling in time gets everything back, late the
 * provider keeps LATE_CANCEL_SHARE (commission only on that share); the provider cancelling refunds everything and a late
 * one counts on their public reliability line (roots only). Its additional tasks go with it, in id order under the same
 * lock: unpaid ones (proposed, awaiting-payment) are withdrawn, paid (`confirmed`) ones cancelled by the same rule on their
 * own amount and start. Others (finished ...) keep their own clock.
 * Step 1 records all of it in one owner transaction (so the click is never lost); step 2 settles each, the root first; a
 * failed settle leaves the booking `cancelled` and unsettled, flags staff, and the timer retries. A second tap returns the
 * cancelled booking unchanged.
 *   crash / failure point                 | left behind                                   | the retry (timer)
 *   before step 1 commits                 | nothing                                       | the customer taps again
 *   after step 1, before / during settle  | cancelled, paid, released_at null              | settleCancelled with the same share
 *   settle partly done (refund, no transfer) | refund row                                 | the same split (chargedCents), refund skipped
 *   after settle, before the messages     | settled, messages lost (logged)               | nothing
 */
export async function cancelBooking(tx: Tx, userId: string, bookingId: string, now = new Date()): Promise<Booking> {
  const side = await sideOf(tx, userId, bookingId)
  const done = await db.transaction(async (o) => {
    const b = await lockRow(o, bookingId)
    if (b.status === 'cancelled') return []
    if (b.status !== 'confirmed') fail(409, { error: 'not-open' })
    if (now >= b.startAt) fail(409, { error: 'STARTED' })
    const cancel = async (r: Row) =>
      (await o.update(bookings).set({ status: 'cancelled', cancelledAt: now, cancelledBy: side, lateCancel: isLate(r.startAt, now), updatedAt: now }).where(eq(bookings.id, r.id)).returning())[0]!
    const out = [await cancel(b)]
    const kids = await o.select().from(bookings).where(eq(bookings.parentBookingId, b.id)).orderBy(bookings.id).for('update')
    const unpaid = kids.filter((k) => k.status === 'proposed' || k.status === 'awaiting-payment').map((k) => k.id)
    if (unpaid.length) await o.update(bookings).set({ status: 'withdrawn', updatedAt: now }).where(inArray(bookings.id, unpaid))
    for (const k of kids) if (k.status === 'confirmed') out.push(await cancel(k))
    return out
  })
  for (const b of done) await trySettleCancelled(b.id, b.customerId, now)
  for (const b of done) await tellCancelled(b)
  return reload(bookingId)
}

/**
 * Either side reports that the OTHER did not turn up: from `confirmed`, once the start has come (else 409 TOO_EARLY).
 * Sets `noShow` (the other side) and `noShowReportedAt`; the status stays `confirmed` until the reported side objects
 * (a dispute) or NO_SHOW_OBJECTION_HOURS pass (resolveNoShow). Meanwhile Finished, confirm and the silent-provider rules
 * leave the booking alone. The reported side is told, with the deadline. A second tap returns it unchanged; a report back
 * by the reported side is 409 NO_SHOW_REPORTED. Only this booking: an additional task is reported on its own.
 */
export async function reportNoShow(tx: Tx, userId: string, bookingId: string, now = new Date()): Promise<Booking> {
  const them = otherSide(await sideOf(tx, userId, bookingId))
  const row = await db.transaction(async (o) => {
    const b = await lockRow(o, bookingId)
    if (b.noShow === them) return null
    if (b.status !== 'confirmed') fail(409, { error: 'not-open' })
    if (b.noShow) fail(409, { error: 'NO_SHOW_REPORTED' })
    if (now < b.startAt) fail(409, { error: 'TOO_EARLY' })
    return (await o.update(bookings).set({ noShow: them, noShowReportedAt: now, updatedAt: now }).where(eq(bookings.id, b.id)).returning())[0]!
  })
  if (row) {
    const to = them === 'customer' ? row.customerId : await ownerOf(row.providerId)
    if (to) await notifyBookingEvent('no-show-reported', to, { bookingId: row.id, date: objectBy(row).toISOString() })
  }
  return reload(bookingId)
}

/**
 * The reported side objects within NO_SHOW_OBJECTION_HOURS (after: 409 OBJECTION_CLOSED; the reporter: 403): a dispute
 * `no-show-objection` with their description (no contact details, 422), the booking `disputed`, no money moves; staff
 * decide (Task 8). A second tap returns the disputed booking.
 */
export async function objectNoShow(tx: Tx, userId: string, bookingId: string, input: NoShowObjection, now = new Date()): Promise<Booking> {
  const side = await sideOf(tx, userId, bookingId)
  await db.transaction(async (o) => {
    const b = await lockRow(o, bookingId)
    if (!b.noShow) fail(409, { error: 'not-open' })
    if (b.noShow !== side) fail(403, { error: 'not-your-turn' })
    if (b.status === 'disputed' && (await o.select({ id: disputes.id }).from(disputes).where(and(eq(disputes.bookingId, b.id), eq(disputes.reason, 'no-show-objection')))).length) return
    if (b.status !== 'confirmed') fail(409, { error: 'not-open' })
    if (now >= objectBy(b)) fail(409, { error: 'OBJECTION_CLOSED' })
    await assertNoContactDetails(userId, input.description)
    await openDisputeCore(o, { bookingId: b.id, openedBy: side, reason: 'no-show-objection', description: input.description, now })
  })
  return reload(bookingId)
}

/**
 * Timer step: a no-show report unanswered for NO_SHOW_OBJECTION_HOURS stands. The booking becomes `cancelled` (the money
 * follows in the timer's settle loop: customer no-show, the provider is paid in full minus commission; provider no-show,
 * a full refund). Then the provider no-show rule (root bookings, 12 months up to `now`): the first gets a
 * `provider-warning`, from the second on staff get one open `provider-no-shows` flag (to suspend for 30 days with the
 * suspension tool). The reporter is told. Owner connection, row locked and re-checked (an objection racing it: one wins).
 * False when there was nothing to do.
 */
export async function resolveNoShow(exec: Exec, bookingId: string, now: Date): Promise<boolean> {
  const r = await exec.transaction(async (o) => {
    const b = await lockRow(o, bookingId)
    if (b.status !== 'confirmed' || !b.noShow || !b.noShowReportedAt || objectBy(b) > now) return null
    const [row] = await o.update(bookings).set({ status: 'cancelled', cancelledAt: now, updatedAt: now }).where(eq(bookings.id, b.id)).returning()
    if (b.noShow !== 'provider' || b.parentBookingId) return { row: row!, warn: false }
    const n = (
      await o.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM bookings WHERE provider_id = ${b.providerId} AND parent_booking_id IS NULL AND no_show = 'provider'
        AND status IN ('cancelled', 'refunded') AND no_show_reported_at > ${now.toISOString()}::timestamptz - interval '12 months'`)
    ).rows[0]!.n
    if (n >= 2) await flagForStaff(o, { kind: 'provider-no-shows', refId: b.providerId, note: `${n} no-shows in 12 months` })
    return { row: row!, warn: n < 2 }
  })
  if (!r) return false
  await tellCancelled(r.row)
  const owner = r.warn ? await ownerOf(r.row.providerId) : undefined
  if (owner) await notifyBookingEvent('provider-warning', owner, { bookingId: r.row.id })
  return true
}

/** The due no-show reports (timers.ts), one at a time; a failure is logged and retried next run. */
export async function resolveNoShows(exec: Exec, now: Date): Promise<number> {
  const due = (
    await exec.execute<{ id: string }>(sql`
    SELECT id FROM bookings WHERE status = 'confirmed' AND no_show IS NOT NULL
      AND no_show_reported_at + make_interval(hours => ${NO_SHOW_OBJECTION_HOURS}) <= ${now.toISOString()}::timestamptz ORDER BY id`)
  ).rows
  let n = 0
  for (const { id } of due) {
    try {
      if (await resolveNoShow(exec, id, now)) n++
    } catch (e) {
      console.error(`[no-show] booking ${id} not resolved: ${describeError(e)}`)
    }
  }
  return n
}
