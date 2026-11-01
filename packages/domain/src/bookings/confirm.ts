import { eq } from 'drizzle-orm'
import { bookings, db, providers, quotes, requests, type Tx } from '@kando/db'
import { DAY, type Booking, type ConfirmQuoteInput } from '@kando/contract'
import { isUuid } from '../admin/common'
import type { AfterCommit } from '../app-request'
import { blockedWithProvider } from '../chat/blocks'
import { assertNoContactDetails } from '../chat/flags'
import { postCard } from '../chat/messages'
import { threadForRequest } from '../chat/threads'
import { canTransact } from '../payments/rules'
import { fail, notFound } from '../providers/http'
import { isSuspendedNow, ownProvider } from '../providers/profile'
import { lockProviderSlots, timeIsAcceptable } from './busy'
import { notifyBookingEvent } from './notify'
import { acceptQuote, lockRequest, toBooking } from './requests'
import { AWAITING_TIME_DAYS, payBy } from './rules'
import { expireLapsedRoot } from './timers'

/**
 * The customer confirms the provider's quote as it is (flow 1): this is the customer's only confirmation, and the booking is
 * created here, never before.
 * - A quote with a time makes the booking `awaiting-payment` at once (payment window from `payBy`, the slot held from now on):
 *   the time is checked again under the provider's slot lock, because a quote holds no slot.
 * - A quote without a time makes it `awaiting-time`: no slot, no payment window, no money. The customer's requested time stays
 *   in the row as a stand-in until both sides agree the real one (agreed-time.ts).
 * The writes run on the owner connection after the checks, as additional tasks do (the app role may only insert a `proposed`
 * booking), with the request locked so two confirms of one quote, or a confirm and a revision, have exactly one outcome.
 * 404 for a stranger, 403 for the provider, 409 quote-expired / quote-not-open / slot-pending. An additional task's quote keeps
 * its own rules (acceptQuote).
 */
export async function confirmQuote(tx: Tx, userId: string, quoteId: string, input: ConfirmQuoteInput, now = new Date(), afterCommit: AfterCommit = () => {}): Promise<Booking> {
  const read = async () => {
    const q = isUuid(quoteId) ? (await tx.select().from(quotes).where(eq(quotes.id, quoteId)))[0] : undefined
    const r = q && (await tx.select().from(requests).where(eq(requests.id, q.requestId)))[0]
    return q && r ? { quote: q, req: r } : null
  }
  const pre = (await read()) ?? notFound() // party check before the lock: a stranger cannot make anyone wait
  if (pre.req.customerId !== userId) {
    if ((await ownProvider(tx, userId))?.id !== pre.req.providerId) return notFound()
    return fail(403, { error: 'not-your-turn' }) // the provider read it, but only the customer confirms
  }
  if (pre.req.parentBookingId) return acceptQuote(tx, userId, quoteId, input.note ? { note: input.note } : {}, now, afterCommit)
  if (await blockedWithProvider(tx, userId, pre.req.providerId)) fail(403, { error: 'BLOCKED' })
  if (input.note) await assertNoContactDetails(userId, input.note)
  await lockRequest(tx, pre.req.id)
  if (pre.req.status === 'booked') await expireLapsedRoot(pre.req.id, now) // a lapsed booking gives the job back first
  const { quote, req } = (await read()) ?? notFound() // read again after the lock: a concurrent confirm has committed by now
  if (quote.status === 'expired') fail(409, { error: 'quote-expired' })
  if (quote.status !== 'sent' || req.status !== 'quoted') fail(409, { error: 'quote-not-open' })
  if (quote.expiresAt <= now) fail(409, { error: 'quote-expired' })
  const provider = (await tx.select().from(providers).where(eq(providers.id, req.providerId)))[0]
  if (!provider || quote.providerId !== req.providerId) return notFound()
  // a suspended or unpublished provider row is hidden from the customer by RLS: that is unavailable too
  if (provider.status !== 'published' || (await isSuspendedNow(tx, provider.id))) return fail(409, { error: 'provider-unavailable' })
  if (!canTransact(provider)) fail(409, { error: 'PROVIDER_NOT_READY' }) // the provider's payouts stopped being ready since the quote

  const hasTime = quote.startAt !== null && quote.durationMin !== null
  // without a time the booking carries a stand-in (the request's time) until both agree one; a stand-in already past becomes the end
  // of the waiting period, so no booking ever holds a past start
  const answerBy = new Date(now.getTime() + AWAITING_TIME_DAYS * DAY)
  const startAt = quote.startAt ?? (req.startAt && req.startAt > now ? req.startAt : answerBy)
  const durationMin = quote.durationMin ?? req.durationMin
  const onSite = req.onSite ?? true
  if (!startAt || !durationMin) return fail(400, { error: 'time-required' })
  if (hasTime) {
    await lockProviderSlots(tx, provider.id)
    await timeIsAcceptable(tx, { providerId: provider.id, startAt, durationMin, onSite, now })
  }

  const row = await db.transaction(async (o) => {
    await o.update(quotes).set({ status: 'accepted' }).where(eq(quotes.id, quote.id))
    await o.update(requests).set({ status: 'booked', updatedAt: now }).where(eq(requests.id, req.id))
    const [b] = await o
      .insert(bookings)
      .values({
        customerId: userId,
        providerId: provider.id,
        serviceId: req.serviceId,
        quoteId: quote.id,
        source: 'quote',
        status: hasTime ? 'awaiting-payment' : 'awaiting-time',
        startAt,
        durationMin,
        onSite,
        ...(onSite && req.addressPostcode && { addressStreet: req.addressStreet, addressPostcode: req.addressPostcode, addressCity: req.addressCity }),
        note: input.note ?? req.note,
        amount: quote.amount, // the bookings_fill_amount trigger sets the same from the quote
        currency: quote.currency,
        ...(hasTime ? { payBy: payBy(now, startAt), acceptedAt: now } : { answerBy }),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
    return b!
  })
  const threadId = await threadForRequest(tx, req.id)
  afterCommit(() => postCard(threadId, userId, { type: 'acceptance', refId: row.id, amount: Number(row.amount), currency: row.currency as 'EUR' }))
  afterCommit(() => notifyBookingEvent('quote-confirmed', provider.ownerId, { bookingId: row.id }))
  return toBooking(row, now)
}
