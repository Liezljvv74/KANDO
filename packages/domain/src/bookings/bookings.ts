import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { bookings, type Tx } from '@kando/db'
import { LIST_PAGE, type Booking, type BookingView, type Page } from '@kando/contract'
import { NO_ID } from '../admin/common'
import { fail, notFound } from '../providers/http'
import { ownProvider } from '../providers/profile'
import { threadIdOf } from '../chat/threads'
import { olderThan, pageOf, stampOf } from '../paging'
import { lockRow, partyOf } from './party'
import { toBooking } from './requests'
import { canTransition } from './rules'

type Row = typeof bookings.$inferSelect

/** The job address stays private to the customer; the provider sees it only once the booking was accepted (payBy is set then). */
export const view = (b: Row, userId: string, now = new Date()): Booking => {
  const dto = toBooking(b, now)
  return b.customerId !== userId && b.payBy === null ? { ...dto, address: null } : dto
}

/**
 * The caller's bookings as customer or as provider owner, a page of root bookings newest first by (created_at, id); each root
 * is followed by its additional tasks (oldest first), so a task is always on its root's page.
 */
export async function listBookings(tx: Tx, userId: string, role: 'customer' | 'provider', cursor?: string): Promise<Page<Booking>> {
  const mine = role === 'customer' ? eq(bookings.customerId, userId) : eq(bookings.providerId, (await ownProvider(tx, userId))?.id ?? NO_ID)
  const found = await tx
    .select({ b: bookings, ts: stampOf(bookings.createdAt), id: bookings.id })
    .from(bookings)
    .where(and(mine, isNull(bookings.parentBookingId), olderThan(bookings.createdAt, bookings.id, cursor)))
    .orderBy(desc(bookings.createdAt), desc(bookings.id))
    .limit(LIST_PAGE + 1)
  const { rows, next } = pageOf(found)
  const kids = rows.length ? await tx.select().from(bookings).where(and(mine, inArray(bookings.parentBookingId, rows.map((r) => r.id)))).orderBy(asc(bookings.createdAt), asc(bookings.id)) : []
  return { docs: rows.flatMap(({ b }) => [view(b, userId), ...kids.filter((k) => k.parentBookingId === b.id).map((k) => view(k, userId))]), next }
}

/** One booking for one of its parties: which side they are on and its chat. Reads only (no timers, no thread is created). */
export async function getBooking(tx: Tx, userId: string, id: string): Promise<BookingView> {
  const { role } = await partyOf(tx, userId, id) // 404 for anyone else
  const b = (await tx.select().from(bookings).where(eq(bookings.id, id)))[0] ?? notFound()
  return { booking: view(b, userId), viewer: role as BookingView['viewer'], threadId: await threadIdOf(tx, b) }
}

/** "I no longer need this": the customer, from awaiting-time or awaiting-payment. */
export async function withdrawBooking(tx: Tx, userId: string, bookingId: string, now = new Date()): Promise<Booking> {
  if ((await partyOf(tx, userId, bookingId)).role !== 'customer') fail(403, { error: 'wrong-side' })
  const b = await lockRow(tx, bookingId)
  if (!canTransition(b.status as Booking['status'], 'withdrawn')) fail(409, { error: 'not-open' })
  const [row] = await tx.update(bookings).set({ status: 'withdrawn', updatedAt: now }).where(eq(bookings.id, b.id)).returning()
  return view(row!, userId, now)
}
