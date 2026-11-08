import { eq } from 'drizzle-orm'
import { bookings, quoteDocuments, requests, type Tx } from '@kando/db'
import type { Booking, BookingView } from '@kando/contract'
import { fail, notFound } from '../providers/http'
import { jobStates } from './job-state-lookup'
import { lockRow, partyOf } from './party'
import { bookingItem, toBooking, withBookingRefs, withdrawRequest } from './requests'
import { canTransition } from './rules'
import type { AfterCommit } from '../app-request'

type Row = typeof bookings.$inferSelect

/** The job address stays private to the customer; the provider sees it only once the booking was accepted (payBy is set then). */
export const view = (b: Row, userId: string, now = new Date()): Booking => {
  const dto = toBooking(b, now)
  return b.customerId !== userId && b.payBy === null ? { ...dto, address: null } : dto
}

/** One booking for one of its parties: which side they are on and its chat. Reads only (no timers, no thread is created). */
export async function getBooking(tx: Tx, userId: string, id: string): Promise<BookingView> {
  const { role } = await partyOf(tx, userId, id) // 404 for anyone else
  // joined with the quote's document number, so the provider sees exactly which quote was accepted (both parties may read the document)
  const found = (await tx.select({ b: bookings, quoteNumber: quoteDocuments.number }).from(bookings).leftJoin(quoteDocuments, eq(quoteDocuments.quoteId, bookings.quoteId)).where(eq(bookings.id, id)))[0] ?? notFound()
  const dto = view(found.b, userId)
  // one lookup (the row handed in) gives the state and the chat
  const states = await jobStates(tx, userId, [bookingItem(dto, userId)], undefined, [found.b])
  return { booking: (await withBookingRefs(tx, [dto], userId, states))[0]!, viewer: role as BookingView['viewer'], threadId: states.get(dto.id)?.threadId ?? null, quoteNumber: found.quoteNumber }
}

/** "I no longer need this": the customer, from awaiting-time or awaiting-payment. */
export async function withdrawBooking(tx: Tx, userId: string, bookingId: string, now = new Date(), afterCommit: AfterCommit = () => {}): Promise<Booking> {
  if ((await partyOf(tx, userId, bookingId)).role !== 'customer') fail(403, { error: 'wrong-side' })
  const b = await lockRow(tx, bookingId)
  if (!canTransition(b.status as Booking['status'], 'withdrawn')) fail(409, { error: 'not-open' })
  const [row] = await tx.update(bookings).set({ status: 'withdrawn', updatedAt: now }).where(eq(bookings.id, b.id)).returning()
  // A quote-born root booking: the trigger gave the quote back, so the job closes with it (the customer's "Withdraw request"; the provider is told).
  // An additional task only ends its own booking.
  // Only while the request is open again: a quote past its expiry leaves it expired (trigger), and closing that would refuse and undo this withdraw.
  if (row!.requestId && row!.quoteId && !row!.parentBookingId) {
    const [req] = await tx.select({ status: requests.status }).from(requests).where(eq(requests.id, row!.requestId))
    if (req && ['open', 'quoted'].includes(req.status)) await withdrawRequest(tx, userId, row!.requestId, now, afterCommit)
  }
  return (await withBookingRefs(tx, [view(row!, userId, now)], userId))[0]!
}
