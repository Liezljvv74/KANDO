import { and, eq, or } from 'drizzle-orm'
import { bookings, db, providers, quotes, requests, type Tx } from '@kando/db'
import type { AdditionalTaskInput, BookingRequest } from '@kando/contract'
import { blockedWithProvider } from '../chat/blocks'
import { assertNoContactDetails } from '../chat/flags'
import { postCard } from '../chat/messages'
import { threadForBooking } from '../chat/threads'
import type { Exec } from '../providers/eligibility'
import { fail } from '../providers/http'
import { ADDITIONAL_PAY_HOURS } from './ending-rules'
import { lockRow, sideOf } from './finish'
import { notifyBookingEvent } from './notify'
import { liveRequest, toRequest } from './requests'
import { REQUEST_ANSWER_DAYS } from './rules'

type Row = typeof bookings.$inferSelect
const HOUR = 3_600_000
const DAY = 24 * HOUR
/** A booking takes additional tasks while it is paid and open: `confirmed` or `finished`, a root, no no-show reported. */
const takesAdditional = (b: Row) => !b.parentBookingId && (b.status === 'confirmed' || b.status === 'finished') && !b.noShow

/**
 * Locks a booking and its additional tasks (owner connection, id order, as account deletion locks) and returns them, the
 * booking first. The second read sees an additional task whose accept committed while this one waited for the booking
 * (an accept locks the parent before it inserts the child), so cancel and no-show never miss one.
 */
export async function lockFamily(o: Exec, id: string): Promise<[Row, Row[]]> {
  const family = or(eq(bookings.id, id), eq(bookings.parentBookingId, id))
  await o.select({ id: bookings.id }).from(bookings).where(family).orderBy(bookings.id).for('update')
  const rows = await o.select().from(bookings).where(family).orderBy(bookings.id).for('update')
  const b = rows.find((r) => r.id === id) ?? fail(404, { error: 'Not found' })
  return [b, rows.filter((r) => r.id !== id)]
}

/**
 * "Additional task" (the customer) or "Scope/quote review" (the provider) on a `confirmed` or `finished` root booking (else
 * 409 not-open): a request for the extra work with `parentBookingId`, the same customer, provider and service, answered by
 * the provider's quote (sendQuote) within REQUEST_ANSWER_DAYS. One open one per booking (409 request-limit). The
 * description runs the contact check (422). An `additional-task` card goes into the booking's thread and the other side is
 * told. A third person 404. The request is written on the owner connection (the app role's insert rule is the customer's)
 * with the booking row locked, so a racing cancel or no-show report has exactly one outcome.
 */
export async function startAdditionalTask(tx: Tx, userId: string, bookingId: string, input: AdditionalTaskInput, now = new Date()): Promise<BookingRequest> {
  const side = await sideOf(tx, userId, bookingId)
  const pair = (await tx.select({ c: bookings.customerId, p: bookings.providerId }).from(bookings).where(eq(bookings.id, bookingId)))[0]!
  if (await blockedWithProvider(tx, pair.c, pair.p)) fail(403, { error: 'BLOCKED' })
  await assertNoContactDetails(userId, input.description)
  const r = await db.transaction(async (o) => {
    const b = await lockRow(o, bookingId)
    if (!takesAdditional(b)) fail(409, { error: 'not-open' })
    if ((await o.select({ id: requests.id }).from(requests).where(and(eq(requests.parentBookingId, b.id), liveRequest(now)))).length) fail(409, { error: 'request-limit' })
    const [row] = await o
      .insert(requests)
      .values({ customerId: b.customerId, providerId: b.providerId, serviceId: b.serviceId, parentBookingId: b.id, description: input.description, answerBy: new Date(now.getTime() + REQUEST_ANSWER_DAYS * DAY), createdAt: now, updatedAt: now })
      .returning()
    return { row: row!, threadId: await threadForBooking(o, b.id) }
  })
  await postCard(r.threadId, userId, { type: 'additional-task', refId: r.row.id })
  const to = side === 'customer' ? (await db.select({ id: providers.ownerId }).from(providers).where(eq(providers.id, r.row.providerId)))[0]?.id : r.row.customerId
  if (to) await notifyBookingEvent('additional-task-requested', to, { requestId: r.row.id })
  return toRequest(r.row)
}

/**
 * acceptQuote for an additional task's quote (requests.ts; the caller holds the request lock and checked the quote, the
 * customer and the provider): the child booking, on the owner connection, with the parent row locked (a racing cancel or
 * no-show report: one outcome; a parent no longer `confirmed`/`finished` or with a reported no-show is 409 not-open). It
 * names its quote (the amount follows the quote, bookings_fill_amount) and its parent, takes the parent's start,
 * duration, place and address (no time to confirm, no slot check: the parent holds the time), and awaits payment for
 * ADDITIONAL_PAY_HOURS. The quote and request are closed in the same transaction, so a second accept finds them closed.
 */
export async function acceptAdditional(quote: typeof quotes.$inferSelect, req: typeof requests.$inferSelect, note: string | null, now: Date): Promise<Row> {
  return db.transaction(async (o) => {
    const [p] = await o.select().from(bookings).where(eq(bookings.id, req.parentBookingId!)).for('update')
    if (!p || !takesAdditional(p)) return fail(409, { error: 'not-open' })
    await o.update(quotes).set({ status: 'accepted' }).where(eq(quotes.id, quote.id))
    await o.update(requests).set({ status: 'booked', updatedAt: now }).where(eq(requests.id, req.id))
    const [row] = await o
      .insert(bookings)
      .values({
        customerId: p.customerId,
        providerId: p.providerId,
        quoteId: quote.id,
        parentBookingId: p.id,
        source: 'quote',
        status: 'awaiting-payment',
        startAt: p.startAt,
        durationMin: p.durationMin,
        onSite: p.onSite,
        addressStreet: p.addressStreet,
        addressPostcode: p.addressPostcode,
        addressCity: p.addressCity,
        note,
        amount: quote.amount, // the trigger copies it from the quote anyway
        currency: quote.currency,
        payBy: new Date(now.getTime() + ADDITIONAL_PAY_HOURS * HOUR),
        acceptedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    return row!
  })
}

/** True when `b` is an additional task whose root has a reported no-show (the root's report covers it, cancel.ts). */
export async function parentNoShow(o: Exec, b: Pick<Row, 'parentBookingId'>): Promise<boolean> {
  if (!b.parentBookingId) return false
  return !!(await o.select({ n: bookings.noShow }).from(bookings).where(eq(bookings.id, b.parentBookingId)))[0]?.n
}
