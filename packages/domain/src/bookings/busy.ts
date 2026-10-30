import { and, eq, gt, inArray, ne, or, sql } from 'drizzle-orm'
import { bookings, db, providers, SLOT_HOLDING_STATUSES, type Tx } from '@kando/db'
import type { BusyTime } from '@kando/contract'
import type { Exec } from '../providers/eligibility'
import { fail } from '../providers/http'
import { isSuspendedNow } from '../providers/profile'
import { BUFFER_MINUTES, overlaps } from './rules'

/** The provider's busy ranges (time and state only) overlapping [from, to) (half-open); 404 for an unknown, unpublished or suspended provider. */
export async function busyTimes(tx: Tx, slug: string, from: Date, to: Date): Promise<BusyTime[]> {
  const [p] = await tx.select({ id: providers.id }).from(providers).where(and(eq(providers.slug, slug), eq(providers.status, 'published')))
  if (!p || (await isSuspendedNow(tx, p.id))) return fail(404, { error: 'Not found' })
  const { rows } = await tx.execute<{ start_at: Date; end_at: Date; state: BusyTime['state'] }>(sql`SELECT * FROM busy_times(${p.id}::uuid, ${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz)`)
  return rows.map((r) => ({ startAt: new Date(r.start_at).toISOString(), endAt: new Date(r.end_at).toISOString(), state: r.state }))
}

/** Serialises slot-taking actions of one provider (two accepts on overlapping times cannot interleave). */
export const lockProviderSlots = (tx: Tx, providerId: string) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('booking_slot'), hashtext(${providerId}))`)

/**
 * True when a paid booking (SLOT_HOLDING_STATUSES: confirmed, or ended with the work on) or an awaiting-payment booking of the provider overlaps the span (assertSlotFree turns that into 409 slot-pending); with
 * `pendingOnly` only awaiting-payment ones count. The 30-minute buffer applies only when both bookings are on site. Proposed bookings never block,
 * and neither does a booking whose payment window has passed (pay_by), even before a sweep marks it.
 */
export async function slotIsHeld(tx: Exec, providerId: string, startAt: Date, durationMin: number, onSite: boolean, now: Date, ignoreBookingId?: string, pendingOnly = false): Promise<boolean> {
  const pending = and(eq(bookings.status, 'awaiting-payment'), gt(bookings.payBy, now))
  const held = await tx
    .select()
    .from(bookings)
    .where(and(eq(bookings.providerId, providerId), pendingOnly ? pending : or(pending, inArray(bookings.status, [...SLOT_HOLDING_STATUSES])), ...(ignoreBookingId ? [ne(bookings.id, ignoreBookingId)] : [])))
  const span = { start: startAt, end: new Date(startAt.getTime() + durationMin * 60_000) }
  // ponytail: scans all of the provider's awaiting-payment and confirmed bookings; add a time-window filter if that list grows large
  return held.some((b) => overlaps(span, { start: b.startAt, end: new Date(b.startAt.getTime() + b.durationMin * 60_000) }, onSite && b.onSite ? BUFFER_MINUTES : 0))
}

/** Reads on the owner connection: a customer's RLS transaction cannot see other customers' holds. The provider lock is held, and other accepts commit before releasing it. */
export async function assertSlotFree(_tx: Tx, providerId: string, startAt: Date, durationMin: number, onSite: boolean, now: Date, ignoreBookingId?: string): Promise<void> {
  if (await slotIsHeld(db, providerId, startAt, durationMin, onSite, now, ignoreBookingId)) fail(409, { error: 'slot-pending' })
}
