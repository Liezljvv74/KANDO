import { and, eq, notInArray, or } from 'drizzle-orm'
import { bookings, db, providers, quotes, requests, type Tx } from '@kando/db'
import { DAY, HOUR, type AdditionalTaskInput, type BookingRequest } from '@kando/contract'
import { blockedWithProvider } from '../chat/blocks'
import { assertNoContactDetails } from '../chat/flags'
import { postCard } from '../chat/messages'
import { threadForBooking } from '../chat/threads'
import type { Exec } from '../providers/eligibility'
import { fail } from '../providers/http'
import { ADDITIONAL_PAY_HOURS } from './ending-rules'
import { notifyBookingEvent } from './notify'
import { lockRow, partyOf } from './party'
import { liveRequest, toRequest } from './requests'
import { REQUEST_ANSWER_DAYS } from './rules'

type Row = typeof bookings.$inferSelect
/** A booking takes additional tasks while it is paid and open: `confirmed` or `finished`, a root, no no-show reported. */
const takesAdditional = (b: Row) => !b.parentBookingId && (b.status === 'confirmed' || b.status === 'finished') && !b.noShow

const LATE = new Error('an additional task committed while the family lock waited')

/**
 * Locks a booking and its additional tasks in ONE read in id order (as account deletion locks, so the two never deadlock)
 * and returns them, the booking first. An accept locks the parent before it inserts the child, so a child can commit
 * while this read waits for the parent and be missed by it: a fresh check then finds it, the read's locks are let go
 * (its savepoint rolled back) and the read runs again, now in id order with the child. Cancel and no-show never miss one.
 */
export async function lockFamily(o: Exec, id: string): Promise<[Row, Row[]]> {
  const family = or(eq(bookings.id, id), eq(bookings.parentBookingId, id))
  for (let attempt = 1; ; attempt++) {
    try {
      return await o.transaction(async (s) => {
        const rows = await s.select().from(bookings).where(family).orderBy(bookings.id).for('update')
        const b = rows.find((r) => r.id === id) ?? fail(404, { error: 'Not found' })
        const late = await s.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.parentBookingId, id), notInArray(bookings.id, rows.map((r) => r.id))))
        if (late.length) throw LATE
        return [b, rows.filter((r) => r.id !== id)] as [Row, Row[]]
      })
    } catch (e) {
      if (e !== LATE || attempt >= 3) throw e // ponytail: 3 tries; a new child accepted during every try is not a real pattern
    }
  }
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
  const side = (await partyOf(tx, userId, bookingId)).role
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
  if (to) await notifyBookingEvent('additional-task-requested', to, { requestId: r.row.id, ...(side === 'customer' && { role: 'provider' }) }) // the provider is asked to quote
  return toRequest(r.row, now)
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

/** The root statuses after which an unpaid additional task can no longer be paid (the job it adds to is over). */
const ROOT_OVER = ['refunded', 'completed', 'stopped', 'cancelled']

/**
 * True when `b` is an additional task that may no longer be paid: its root has a reported no-show (the report covers it,
 * cancel.ts) or has ended (refunded, completed, stopped, cancelled). The pay link refuses it and a payment that still
 * arrives is refunded in full (webhook.ts, the late-payment path).
 */
export async function parentBlocksPayment(o: Exec, b: Pick<Row, 'parentBookingId'>): Promise<boolean> {
  if (!b.parentBookingId) return false
  const p = (await o.select({ noShow: bookings.noShow, status: bookings.status }).from(bookings).where(eq(bookings.id, b.parentBookingId)))[0]
  return !p || !!p.noShow || ROOT_OVER.includes(p.status)
}

/** True when `b` is an additional task whose root has a reported no-show (the root's report covers it, cancel.ts). */
export async function parentNoShow(o: Exec, b: Pick<Row, 'parentBookingId'>): Promise<boolean> {
  if (!b.parentBookingId) return false
  return !!(await o.select({ n: bookings.noShow }).from(bookings).where(eq(bookings.id, b.parentBookingId)))[0]?.n
}
