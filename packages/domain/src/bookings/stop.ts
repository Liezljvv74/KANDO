import { eq } from 'drizzle-orm'
import { bookings, db, providers, type Tx } from '@kando/db'
import type { Booking, StopAmountInput, StopAnswer } from '@kando/contract'
import { assertNoContactDetails } from '../chat/flags'
import { fail } from '../providers/http'
import { toCents } from '../payments/rules'
import { openDisputeCore, tellDisputeOpened } from './disputes'
import { STOP_ANSWER_DAYS } from './ending-rules'
import { lockRow, reload, sideOf, tryRelease } from './finish'
import { notifyBookingEvent } from './notify'

const DAY = 86_400_000
const ownerOf = async (providerId: string) => (await db.select({ id: providers.ownerId }).from(providers).where(eq(providers.id, providerId)))[0]?.id

/**
 * Either side stops a `confirmed` job once its start has come ("stop job halfway"; before it 409 NOT_STARTED: the
 * cancellation rules apply, cancel.ts), else 409 not-open; a reported no-show ends its own way: 409 NO_SHOW_REPORTED. Status `stopped`, `stoppedAt`, `stoppedBy`. No money moves: what is not yet earned stays held until
 * the provider states the amount earned and the customer agrees, or staff decide. The other side is told. A second tap
 * returns the stopped booking unchanged. Owner connection (stopped is an owner-only status), the row locked and re-checked.
 * Its additional tasks keep their own clock (each is stopped on its own).
 */
export async function stopJob(tx: Tx, userId: string, bookingId: string, now = new Date()): Promise<Booking> {
  const side = await sideOf(tx, userId, bookingId)
  const row = await db.transaction(async (o) => {
    const b = await lockRow(o, bookingId)
    if (b.status === 'stopped') return null
    if (b.status !== 'confirmed') fail(409, { error: 'not-open' })
    if (b.noShow) fail(409, { error: 'NO_SHOW_REPORTED' })
    if (now < b.startAt) fail(409, { error: 'NOT_STARTED' }) // before the start the cancellation rules apply (cancel.ts)
    return (await o.update(bookings).set({ status: 'stopped', stoppedAt: now, stoppedBy: side, updatedAt: now }).where(eq(bookings.id, b.id)).returning())[0]!
  })
  if (row) {
    const to = side === 'customer' ? await ownerOf(row.providerId) : row.customerId
    if (to) await notifyBookingEvent('job-stopped', to, { bookingId: row.id })
  }
  return reload(bookingId)
}

/**
 * The provider states what was earned up to the stop: 0 up to the booking amount, whole cents (else 400
 * INVALID_STOP_AMOUNT); an optional note (no contact details, 422). The app works it out (hours times the rate for hourly
 * work, a percentage of the price for fixed-price work); the server stores the amount. Only on a `stopped` booking
 * (409 not-open), once: the customer answers exactly what was stated (the same statement again returns it; a different
 * one is 409 ALREADY_STATED). The customer is told, with the date their answer is due (STOP_ANSWER_DAYS, then staff).
 */
export async function stateStopAmount(tx: Tx, userId: string, bookingId: string, input: StopAmountInput, now = new Date()): Promise<Booking> {
  if ((await sideOf(tx, userId, bookingId)) !== 'provider') fail(403, { error: 'not-your-turn' })
  const note = input.note?.trim() || null
  if (note) await assertNoContactDetails(userId, note)
  const row = await db.transaction(async (o) => {
    const b = await lockRow(o, bookingId)
    if (b.status !== 'stopped') fail(409, { error: 'not-open' })
    const cents = toCents(input.amount)
    if (cents / 100 !== input.amount) fail(400, { error: 'INVALID_STOP_AMOUNT' }) // whole cents only, never rounded
    if (b.stopStatedAt) {
      if (toCents(Number(b.stopAmount)) === cents && b.stopNote === note) return null
      fail(409, { error: 'ALREADY_STATED' })
    }
    if (cents < 0 || cents > toCents(Number(b.amount))) fail(400, { error: 'INVALID_STOP_AMOUNT' })
    return (await o.update(bookings).set({ stopAmount: (cents / 100).toFixed(2), stopNote: note, stopStatedAt: now, updatedAt: now }).where(eq(bookings.id, b.id)).returning())[0]!
  })
  if (row) await notifyBookingEvent('stop-amount-stated', row.customerId, { bookingId: row.id, date: new Date(now.getTime() + STOP_ANSWER_DAYS * DAY).toISOString() })
  return reload(bookingId)
}

/**
 * The customer answers the stated amount (provider 403, third person 404; nothing stated yet or no longer stopped: 409
 * not-open). Agree: step 1 records the agreement on its own (`confirmBy = now`: the payment is due), so it is never lost;
 * step 2 pays the stated amount to the provider (commission on that amount only) and refunds the rest (releaseBooking,
 * share from the stored `stopAmount`). If step 2 fails the booking stays `stopped` with the payment due, staff are
 * flagged and the timer retries. Disagree: a `stop-disagreed` dispute for staff (the money stays held). A second answer
 * returns the booking unchanged. Owner connection, the row locked and re-checked against the 7-day timer (one outcome).
 */
export async function answerStop(tx: Tx, userId: string, bookingId: string, answer: StopAnswer, now = new Date()): Promise<Booking> {
  if ((await sideOf(tx, userId, bookingId)) !== 'customer') fail(403, { error: 'not-your-turn' })
  const r = await db.transaction(async (o) => {
    const b = await lockRow(o, bookingId)
    if (b.status === 'completed' && b.stoppedAt) return null
    if (b.status !== 'stopped' || !b.stopStatedAt) fail(409, { error: 'not-open' })
    if (b.confirmBy) return { b, agree: true } // agreed before; the payment is due (a retry)
    if (answer.agree) return { b: (await o.update(bookings).set({ confirmBy: now, updatedAt: now }).where(eq(bookings.id, b.id)).returning())[0]!, agree: true }
    await openDisputeCore(o, { bookingId: b.id, openedBy: 'customer', reason: 'stop-disagreed', description: '', now })
    return { b, agree: false }
  })
  if (r?.agree) await tryRelease(db, r.b.id, r.b.customerId, now)
  else if (r) await tellDisputeOpened(r.b)
  return reload(bookingId)
}
