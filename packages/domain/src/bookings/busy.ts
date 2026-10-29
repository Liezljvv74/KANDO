import { and, eq, ne, sql } from 'drizzle-orm'
import { bookings, providers, type Tx } from '@kando/db'
import type { BusyTime } from '@kando/contract'
import { fail } from '../providers/http'
import { isSuspendedNow } from '../providers/profile'
import { BUFFER_MINUTES, overlaps } from './rules'

/** The provider's busy ranges (time and state only) in [from, to]; 404 for an unknown, unpublished or suspended provider. */
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
 * 409 slot-pending when an awaiting-payment booking of the provider overlaps the span. The 30-minute buffer applies
 * only when both bookings are on site. Proposed bookings never block.
 */
export async function assertSlotFree(tx: Tx, providerId: string, startAt: Date, durationMin: number, onSite: boolean, ignoreBookingId?: string): Promise<void> {
  const held = await tx
    .select()
    .from(bookings)
    .where(and(eq(bookings.providerId, providerId), eq(bookings.status, 'awaiting-payment'), ...(ignoreBookingId ? [ne(bookings.id, ignoreBookingId)] : [])))
  const span = { start: startAt, end: new Date(startAt.getTime() + durationMin * 60_000) }
  // ponytail: scans all of the provider's awaiting-payment bookings; add a time-window filter if that list grows large
  const clash = held.some((b) => overlaps(span, { start: b.startAt, end: new Date(b.startAt.getTime() + b.durationMin * 60_000) }, onSite && b.onSite ? BUFFER_MINUTES : 0))
  if (clash) fail(409, { error: 'slot-pending' })
}
