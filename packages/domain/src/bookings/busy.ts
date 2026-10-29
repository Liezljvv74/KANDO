import { and, eq, ne, sql } from 'drizzle-orm'
import { bookings, type Tx } from '@kando/db'
import { fail } from '../providers/http'
import { BUFFER_MINUTES, overlaps } from './rules'

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
