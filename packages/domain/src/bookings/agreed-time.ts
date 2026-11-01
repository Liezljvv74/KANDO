import { eq } from 'drizzle-orm'
import { bookings, db, providers, type Tx } from '@kando/db'
import { type AgreedTimeInput, type Booking } from '@kando/contract'
import type { AfterCommit } from '../app-request'
import { fail, notFound } from '../providers/http'
import { lockProviderSlots, timeIsAcceptable } from './busy'
import { notifyBookingEvent } from './notify'
import { lockRow, partyOf } from './party'
import { view } from './bookings'
import { DAY } from '@kando/contract'
import { blockedWithProvider } from '../chat/blocks'
import { canTransact } from '../payments/rules'
import { isSuspendedNow } from '../providers/profile'
import { payBy, TIME_ANSWER_DAYS } from './rules'

type Row = typeof bookings.$inferSelect

const pending = (b: Row, now: Date) => b.timeProposedBy && b.timeProposedStartAt && b.timeAnswerBy && b.timeAnswerBy > now // a time not answered in 2 days falls away

/**
 * After a quote was confirmed without a time (status awaiting-time): either side enters a date and time for the other to
 * confirm. No round limit: the chat is where it is agreed. The time must be acceptable now (timeIsAcceptable); it holds no slot
 * until it is confirmed. A new entry replaces a pending one, whoever made it. 404 stranger, 409 not-open.
 * The booking row is locked and written on the owner connection only: locking it on the request connection too would make
 * the owner connection wait for it.
 */
export async function proposeAgreedTime(tx: Tx, userId: string, bookingId: string, input: AgreedTimeInput, now = new Date(), afterCommit: AfterCommit = () => {}): Promise<Booking> {
  const { role } = await partyOf(tx, userId, bookingId)
  const startAt = new Date(input.startAt)
  const [row, ownerId] = await db.transaction(async (o) => {
    const b = await lockRow(o, bookingId)
    if (b.status !== 'awaiting-time' || (b.answerBy && b.answerBy <= now)) fail(409, { error: 'not-open' })
    if (input.onSite && !b.addressPostcode) fail(400, { error: 'address-required' }) // a remote job cannot become on-site: nobody knows where to go
    await timeIsAcceptable(tx, { providerId: b.providerId, startAt, durationMin: input.durationMin, onSite: input.onSite, now, clash: false }) // a clash is checked at confirm
    const answerBy = new Date(now.getTime() + TIME_ANSWER_DAYS * DAY) // the other side has the full 2 days, so the booking's own deadline moves out with it
    const [r] = await o
      .update(bookings)
      .set({ timeProposedBy: role, timeProposedStartAt: startAt, timeProposedDurationMin: input.durationMin, timeProposedOnSite: input.onSite, timeAnswerBy: answerBy, answerBy: b.answerBy && b.answerBy > answerBy ? b.answerBy : answerBy, updatedAt: now })
      .where(eq(bookings.id, b.id))
      .returning()
    const [p] = await o.select({ o: providers.ownerId }).from(providers).where(eq(providers.id, b.providerId))
    return [r!, p!.o] as const
  })
  afterCommit(() => notifyBookingEvent('time-to-confirm', role === 'customer' ? ownerId : row.customerId, { bookingId: row.id }))
  return view(row, userId, now)
}

/**
 * The other side confirms the pending time: under the provider's slot lock the time is checked again (it may have been taken or
 * passed meanwhile), the booking gets it and becomes awaiting-payment with its payment window. The proposer cannot confirm their own
 * entry (403). 409 not-open when nothing is pending or it fell away.
 */
export async function confirmAgreedTime(tx: Tx, userId: string, bookingId: string, now = new Date(), afterCommit: AfterCommit = () => {}): Promise<Booking> {
  const { role, providerId } = await partyOf(tx, userId, bookingId)
  await lockProviderSlots(tx, providerId)
  const [row, pay] = await db.transaction(async (o) => {
    const b = await lockRow(o, bookingId) // read after the slot lock: a concurrent confirm has committed by now
    if (b.status !== 'awaiting-time' || !pending(b, now) || (b.answerBy && b.answerBy <= now)) fail(409, { error: 'not-open' })
    if (b.timeProposedBy === role) fail(403, { error: 'not-your-turn' })
    // what confirmQuote checks: the customer is not blocked, the provider can still work and be paid
    if (await blockedWithProvider(tx, b.customerId, b.providerId)) fail(403, { error: 'BLOCKED' })
    const [pr] = await o.select().from(providers).where(eq(providers.id, b.providerId))
    if (!pr) return notFound()
    if (pr.status !== 'published' || (await isSuspendedNow(tx, pr.id))) fail(409, { error: 'provider-unavailable' })
    if (!canTransact(pr)) fail(409, { error: 'PROVIDER_NOT_READY' })
    const startAt = b.timeProposedStartAt!
    const durationMin = b.timeProposedDurationMin!
    const onSite = b.timeProposedOnSite ?? true
    await timeIsAcceptable(tx, { providerId: b.providerId, startAt, durationMin, onSite, now })
    const payAt = payBy(now, startAt)
    const [r] = await o
      .update(bookings)
      .set({ status: 'awaiting-payment', startAt, durationMin, onSite, payBy: payAt, acceptedAt: now, answerBy: null, timeProposedBy: null, timeProposedStartAt: null, timeProposedDurationMin: null, timeProposedOnSite: null, timeAnswerBy: null, updatedAt: now })
      .where(eq(bookings.id, b.id))
      .returning()
    return [r!, payAt] as const
  })
  // both sides have confirmed the time: whichever side confirmed last, the customer gets "Payment due" (pay_by from payBy(), the existing payment rules)
  afterCommit(() => notifyBookingEvent('booking-accepted', row.customerId, { bookingId: row.id, date: pay.toISOString() }))
  return view(row, userId, now)
}
