import { and, desc, eq, getTableColumns, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import { bookingAppInsert, bookings, db, providers, quotes, requests, type Tx } from '@kando/db'
import { DAY, HOUR, LIST_PAGE, NO_SHOW_OBJECTION_HOURS, type AcceptQuoteInput, type Booking, type BookingRequest, type Page, type Quote, type QuoteInput, type RequestInput } from '@kando/contract'
import type { AfterCommit } from '../app-request'
import { blockedWithProvider } from '../chat/blocks'
import { assertNoContactDetails } from '../chat/flags'
import { postCard } from '../chat/messages'
import { threadForRequest, threadIdOf } from '../chat/threads'
import { olderThan, pageOf, stampOf } from '../paging'
import { notifyBookingEvent, notifyProposal } from './notify'
import { isUuid, NO_ID } from '../admin/common'
import { offerableServiceIds } from '../providers/eligibility'
import { fail, notFound } from '../providers/http'
import { isSuspendedNow, ownProvider } from '../providers/profile'
import { canTransact } from '../payments/rules'
import { assertFuture, bookingShownStatus, MAX_OPEN_REQUESTS_PER_PAIR, MAX_REQUESTS_PER_DAY, PROPOSAL_ANSWER_HOURS, QUOTE_VALID_DAYS, REQUEST_ANSWER_DAYS } from './rules'
import { acceptAdditional } from './additional'
import { expireLapsedRoot } from './timers'
import { ratingsOf } from '../reviews'

const iso = (d: Date) => d.toISOString()

/**
 * The mappers show a lapsed row as expired (reads never write; the daily cron does): see bookingShownStatus. `reopened`: the
 * request's root booking lapsed (lapsedRoots), so the rows read as trigger bookings_reopen_request will write them.
 */
export const toRequest = (r: typeof requests.$inferSelect, now = new Date(), reopened = false): BookingRequest => {
  const status = reopened && r.status === 'booked' ? 'quoted' : r.status
  return {
    id: r.id,
    customerId: r.customerId,
    providerId: r.providerId,
    serviceId: r.serviceId,
    description: r.description,
    preferredDate: r.preferredDate,
    parentBookingId: r.parentBookingId,
    status: (status === 'open' && r.answerBy <= now ? 'expired' : status) as BookingRequest['status'],
    answerBy: iso(r.answerBy),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  }
}

export const toQuote = (q: typeof quotes.$inferSelect, now = new Date(), reopened = false): Quote => {
  const status = reopened && q.status === 'accepted' ? 'sent' : q.status
  return {
    id: q.id,
    requestId: q.requestId,
    providerId: q.providerId,
    version: q.version,
    amount: Number(q.amount),
    currency: q.currency as Quote['currency'],
    scope: q.scope,
    startAt: q.startAt ? iso(q.startAt) : null,
    durationMin: q.durationMin,
    status: (status === 'sent' && q.expiresAt <= now ? 'expired' : status) as Quote['status'],
    expiresAt: iso(q.expiresAt),
    createdAt: iso(q.createdAt),
  }
}

/** Request id > quote id, for each request whose live root booking reads expired: the job reads open again (no write). */
async function lapsedRoots(tx: Tx, requestIds: string[], now: Date): Promise<Map<string, string | null>> {
  if (!requestIds.length) return new Map()
  const roots = await tx
    .select({ requestId: bookings.requestId, quoteId: bookings.quoteId, status: bookings.status, answerBy: bookings.answerBy, payBy: bookings.payBy })
    .from(bookings)
    .where(and(inArray(bookings.requestId, requestIds), isNull(bookings.parentBookingId), inArray(bookings.status, ['proposed', 'awaiting-payment'])))
  return new Map(roots.filter((b) => bookingShownStatus(b, now) === 'expired').map((b) => [b.requestId!, b.quoteId]))
}

/** Null address parts are left out, as the contract has them optional. */
export const toBooking = (b: typeof bookings.$inferSelect, now = new Date()): Booking => ({
  id: b.id,
  customerId: b.customerId,
  providerId: b.providerId,
  serviceId: b.serviceId,
  quoteId: b.quoteId,
  requestId: b.requestId,
  parentBookingId: b.parentBookingId,
  source: b.source as Booking['source'],
  status: bookingShownStatus(b, now) as Booking['status'],
  startAt: iso(b.startAt),
  durationMin: b.durationMin,
  amount: Number(b.amount),
  currency: b.currency as Booking['currency'],
  onSite: b.onSite,
  address: b.addressPostcode
    ? { postcode: b.addressPostcode, ...(b.addressStreet && { street: b.addressStreet }), ...(b.addressCity && { city: b.addressCity }) }
    : null,
  note: b.note,
  answerBy: b.answerBy ? iso(b.answerBy) : null,
  payBy: b.payBy ? iso(b.payBy) : null,
  counterBy: b.counterBy as Booking['counterBy'],
  finishedAt: b.finishedAt ? iso(b.finishedAt) : null,
  confirmBy: b.confirmBy ? iso(b.confirmBy) : null,
  askedDoneAt: b.askedDoneAt ? iso(b.askedDoneAt) : null,
  cancelledAt: b.cancelledAt ? iso(b.cancelledAt) : null,
  cancelledBy: b.cancelledBy as Booking['cancelledBy'],
  lateCancel: b.lateCancel,
  noShow: b.noShow as Booking['noShow'],
  noShowReportedAt: b.noShowReportedAt ? iso(b.noShowReportedAt) : null,
  noShowObjectBy: b.noShowReportedAt ? iso(new Date(b.noShowReportedAt.getTime() + NO_SHOW_OBJECTION_HOURS * HOUR)) : null,
  stoppedAt: b.stoppedAt ? iso(b.stoppedAt) : null,
  stoppedBy: b.stoppedBy as Booking['stoppedBy'],
  stopAmount: b.stopAmount === null ? null : Number(b.stopAmount),
  stopNote: b.stopNote,
  stopStatedAt: b.stopStatedAt ? iso(b.stopStatedAt) : null,
  createdAt: iso(b.createdAt),
  updatedAt: iso(b.updatedAt),
})

/** A request that still waits for the provider: open before its deadline, or quoted with a quote still valid. */
export const liveRequest = (now: Date) =>
  or(and(eq(requests.status, 'open'), gt(requests.answerBy, now)), and(eq(requests.status, 'quoted'), sql`EXISTS (SELECT 1 FROM quotes q WHERE q.request_id = ${requests.id} AND q.status = 'sent' AND q.expires_at > ${now.toISOString()}::timestamptz)`))

/** Serialises actions on one request (two accepts, or an accept and a new quote, cannot interleave). */
const lockRequest = (tx: Tx, requestId: string) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('booking_request'), hashtext(${requestId}))`)

/**
 * Abuse limits, checked before anything is saved. The customer's advisory lock (held to the end of the transaction) makes two
 * parallel creates take turns, so both cannot pass. The customer reads all their own rows, so the caller's tx counts them.
 * The messages say nothing about other people. `providerId` is null for a direct booking (only the daily limit applies).
 */
export async function assertWithinLimits(tx: Tx, userId: string, providerId: string | null, now: Date): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('request_limit'), hashtext(${userId}))`)
  if (providerId) {
    // a quoted request counts only while its quote is live (the timer leaves it 'quoted' after expiry); an open request past its deadline is as good as expired
    const n = (await tx.select({ n: sql<number>`count(*)::int` }).from(requests).where(and(eq(requests.customerId, userId), eq(requests.providerId, providerId), liveRequest(now))))[0]!.n
    if (n >= MAX_OPEN_REQUESTS_PER_PAIR) fail(409, { error: 'request-limit' })
  }
  const since = new Date(now.getTime() - DAY)
  const r = (await tx.select({ n: sql<number>`count(*)::int` }).from(requests).where(and(eq(requests.customerId, userId), gt(requests.createdAt, since))))[0]!.n
  const b = (await tx.select({ n: sql<number>`count(*)::int` }).from(bookings).where(and(eq(bookings.customerId, userId), eq(bookings.source, 'direct'), gt(bookings.createdAt, since))))[0]!.n
  if (r + b >= MAX_REQUESTS_PER_DAY) fail(409, { error: 'daily-limit' })
}

export async function createRequest(tx: Tx, userId: string, input: RequestInput, now = new Date(), afterCommit: AfterCommit = () => {}): Promise<BookingRequest> {
  await assertWithinLimits(tx, userId, isUuid(input.providerId) ? input.providerId : null, now)
  await assertNoContactDetails(userId, input.description)
  const provider = (await tx.select().from(providers).where(eq(providers.id, input.providerId)))[0]
  if (!provider || provider.status !== 'published' || (await isSuspendedNow(tx, provider.id)) || (await blockedWithProvider(tx, userId, provider.id))) return notFound()
  const offerable = await offerableServiceIds(tx, provider.id)
  if (!offerable.length) return notFound()
  if (provider.ownerId === userId) fail(400, { error: 'own-service' })
  if (!canTransact(provider)) fail(409, { error: 'PROVIDER_NOT_READY' }) // payout set-up unfinished: the app offers "notify me"
  if (input.serviceId && !offerable.includes(input.serviceId)) fail(400, { error: 'Unknown service' })
  const [row] = await tx
    .insert(requests)
    .values({
      customerId: userId,
      providerId: provider.id,
      serviceId: input.serviceId ?? null,
      description: input.description,
      preferredDate: input.preferredDate ?? null,
      answerBy: new Date(now.getTime() + REQUEST_ANSWER_DAYS * DAY),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  await threadForRequest(tx, row!.id) // the chat opens with the request
  afterCommit(() => notifyBookingEvent('request-received', provider.ownerId, { requestId: row!.id }))
  return toRequest(row!, now)
}

/** The caller's requests, a page newest first by (created_at, id): those they sent (customer) or those addressed to their provider profile. */
export async function listRequests(tx: Tx, userId: string, role: 'customer' | 'provider', cursor?: string, now = new Date()): Promise<Page<BookingRequest>> {
  const mine = role === 'customer' ? eq(requests.customerId, userId) : eq(requests.providerId, (await ownProvider(tx, userId))?.id ?? NO_ID)
  const found = await tx
    .select({ r: requests, ts: stampOf(requests.createdAt), id: requests.id })
    .from(requests)
    .where(and(mine, olderThan(requests.createdAt, requests.id, cursor)))
    .orderBy(desc(requests.createdAt), desc(requests.id))
    .limit(LIST_PAGE + 1)
  const { rows, next } = pageOf(found)
  const lapsed = await lapsedRoots(tx, rows.map(({ r }) => r.id), now)
  const list = rows.map(({ r }) => toRequest(r, now, lapsed.has(r.id)))
  return { docs: role === 'provider' ? await withCustomerRatings(tx, list) : list, next }
}

/** The provider's view adds what providers' shown reviews say about each customer. */
async function withCustomerRatings(tx: Tx, list: BookingRequest[]): Promise<BookingRequest[]> {
  const ratings = await ratingsOf(tx, [...new Set(list.map((r) => r.customerId))], 'provider')
  return list.map((r) => ({ ...r, customerRating: ratings.get(r.customerId) ?? null }))
}

/** The request row for one of its parties; 404 for anyone else. */
async function ownRequest(tx: Tx, userId: string, id: string) {
  const row = isUuid(id) ? (await tx.select().from(requests).where(eq(requests.id, id)))[0] : undefined
  if (!row) return notFound()
  if (row.customerId !== userId && (await ownProvider(tx, userId))?.id !== row.providerId) return notFound()
  return row
}

/** One request with its chat, for one of its parties. Reads only: no thread is created. */
export async function getRequest(tx: Tx, userId: string, id: string, now = new Date()): Promise<BookingRequest> {
  const row = await ownRequest(tx, userId, id)
  // an additional task talks in its booking's thread
  const parent = row.parentBookingId ? (await tx.select().from(bookings).where(eq(bookings.id, row.parentBookingId)))[0] : undefined
  const threadId = parent ? await threadIdOf(tx, parent) : await threadIdOf(tx, { id: NO_ID, requestId: row.id, parentBookingId: null })
  const dto = { ...toRequest(row, now, (await lapsedRoots(tx, [row.id], now)).has(row.id)), threadId }
  return row.customerId === userId ? dto : (await withCustomerRatings(tx, [dto]))[0]!
}

/** Quotes of a request, newest version first, for either party. */
export async function listQuotes(tx: Tx, userId: string, requestId: string, now = new Date()): Promise<Quote[]> {
  await ownRequest(tx, userId, requestId)
  const reopened = (await lapsedRoots(tx, [requestId], now)).get(requestId)
  return (await tx.select().from(quotes).where(eq(quotes.requestId, requestId)).orderBy(desc(quotes.version))).map((q) => toQuote(q, now, q.id === reopened))
}

const unavailable = () => fail(409, { error: 'provider-unavailable' })

export async function sendQuote(tx: Tx, userId: string, requestId: string, input: QuoteInput, now = new Date(), afterCommit: AfterCommit = () => {}): Promise<Quote> {
  const provider = (await ownProvider(tx, userId)) ?? notFound()
  if (!isUuid(requestId)) return notFound()
  const own = () => tx.select().from(requests).where(and(eq(requests.id, requestId), eq(requests.providerId, provider.id)))
  const first = (await own())[0]
  if (!first) return notFound() // party check before the lock: a stranger cannot make anyone wait
  if (await blockedWithProvider(tx, first.customerId, provider.id)) fail(403, { error: 'BLOCKED' }) // either side blocked the other
  await assertNoContactDetails(userId, input.scope)
  await lockRequest(tx, requestId)
  if (first.status === 'booked') await expireLapsedRoot(requestId, now) // a lapsed proposal gives the job back first
  const req = (await own())[0]! // read again after the lock
  if (provider.status !== 'published' || (await isSuspendedNow(tx, provider.id))) unavailable()
  if (!canTransact(provider)) fail(409, { error: 'PAYOUT_SETUP_FIRST' })
  if (!['open', 'quoted'].includes(req.status)) fail(409, { error: 'request-closed' })
  // The 3-day answer deadline binds the first quote only; a revision may follow while the last quote is still valid.
  const open = (await tx.select({ e: quotes.expiresAt }).from(quotes).where(and(eq(quotes.requestId, requestId), eq(quotes.status, 'sent'))))[0]
  if (open ? open.e <= now : req.answerBy <= now) fail(409, { error: 'request-closed' })
  if (input.startAt) assertFuture(new Date(input.startAt), now)
  const prev = (await tx.select({ v: quotes.version }).from(quotes).where(eq(quotes.requestId, requestId)).orderBy(desc(quotes.version)).limit(1))[0]
  const currency = (await tx.execute<{ currency: string }>(sql`SELECT currency FROM countries WHERE code = ${provider.country}`)).rows[0]!.currency
  await tx.update(quotes).set({ status: 'superseded' }).where(and(eq(quotes.requestId, requestId), eq(quotes.status, 'sent')))
  const [row] = await tx
    .insert(quotes)
    .values({
      requestId,
      providerId: provider.id,
      version: (prev?.v ?? 0) + 1,
      amount: input.amount.toFixed(2),
      currency,
      scope: input.scope,
      startAt: input.startAt ? new Date(input.startAt) : null,
      durationMin: input.durationMin ?? null,
      expiresAt: new Date(now.getTime() + QUOTE_VALID_DAYS * DAY),
      createdAt: now,
    })
    .returning()
  await tx.update(requests).set({ status: 'quoted', updatedAt: now }).where(eq(requests.id, requestId))
  const threadId = await threadForRequest(tx, requestId)
  // an additional task's quote shows as the additional-task card (with the explainer in the app)
  afterCommit(() => postCard(threadId, userId, req.parentBookingId ? { type: 'additional-task', refId: row!.id, amount: input.amount, currency: row!.currency as 'EUR' } : { type: 'quote', refId: row!.id, amount: input.amount, currency: row!.currency as 'EUR', version: row!.version }))
  afterCommit(() => notifyBookingEvent('quote-received', req.customerId, { requestId, quoteId: row!.id, date: iso(row!.expiresAt) }))
  return toQuote(row!, now)
}

/**
 * Closes an open or quoted request: the customer withdraws it, the provider's owner declines it, and the other side is told.
 * The other party gets 403, anyone else 404. Its sent quote is declined by the trigger requests_close_quotes; the request lock
 * makes a parallel sendQuote either see the closed request (409) or have its new quote declined.
 */
async function closeRequest(tx: Tx, userId: string, requestId: string, by: 'customer' | 'provider', now: Date, afterCommit: AfterCommit): Promise<BookingRequest> {
  const read = async () => (isUuid(requestId) ? (await tx.select().from(requests).where(eq(requests.id, requestId)))[0] : undefined) ?? notFound()
  const first = await read() // party check before the lock: a stranger cannot make anyone wait
  const side = first.customerId === userId ? 'customer' : (await ownProvider(tx, userId))?.id === first.providerId ? 'provider' : notFound()
  if (side !== by) fail(403, { error: 'not-your-turn' })
  await lockRequest(tx, requestId)
  if (first.status === 'booked') await expireLapsedRoot(requestId, now) // a lapsed proposal gives the job back first
  const req = await read() // read again after the lock
  // a lapsed open request is the cron's to expire (it counts toward requests-ignored), never withdrawn or declined
  if (!['open', 'quoted'].includes(req.status) || (req.status === 'open' && req.answerBy <= now)) fail(409, { error: 'request-closed' })
  // the timers' expiry takes no request lock: it may commit after the read, so the UPDATE re-checks the status
  const [row] = await tx
    .update(requests)
    .set({ status: by === 'customer' ? 'withdrawn' : 'declined', updatedAt: now })
    .where(and(eq(requests.id, requestId), inArray(requests.status, ['open', 'quoted'])))
    .returning()
  if (!row) fail(409, { error: 'request-closed' })
  afterCommit(async () => {
    if (by === 'provider') return notifyBookingEvent('request-declined', req.customerId, { requestId })
    // the owner connection: RLS may hide a suspended provider's row from its customer
    const owner = (await db.select({ id: providers.ownerId }).from(providers).where(eq(providers.id, req.providerId)))[0]
    if (owner) await notifyBookingEvent('request-withdrawn', owner.id, { requestId })
  })
  return toRequest(row!, now)
}

export const withdrawRequest = (tx: Tx, userId: string, requestId: string, now = new Date(), afterCommit: AfterCommit = () => {}): Promise<BookingRequest> =>
  closeRequest(tx, userId, requestId, 'customer', now, afterCommit)

export const declineRequest = (tx: Tx, userId: string, requestId: string, now = new Date(), afterCommit: AfterCommit = () => {}): Promise<BookingRequest> =>
  closeRequest(tx, userId, requestId, 'provider', now, afterCommit)

export async function acceptQuote(tx: Tx, userId: string, quoteId: string, input: AcceptQuoteInput, now = new Date(), afterCommit: AfterCommit = () => {}): Promise<Booking> {
  const find = async () => {
    const q = isUuid(quoteId) ? (await tx.select().from(quotes).where(eq(quotes.id, quoteId)))[0] : undefined
    const r = q && (await tx.select().from(requests).where(and(eq(requests.id, q.requestId), eq(requests.customerId, userId))))[0] // only the request's customer
    return q && r ? { quote: q, req: r } : null
  }
  const pre = (await find()) ?? notFound() // party check before the lock: a stranger cannot make anyone wait
  if (await blockedWithProvider(tx, userId, pre.req.providerId)) fail(403, { error: 'BLOCKED' })
  if (input.note) await assertNoContactDetails(userId, input.note)
  await lockRequest(tx, pre.req.id)
  if (pre.req.status === 'booked') await expireLapsedRoot(pre.req.id, now) // a lapsed proposal gives the job back first
  const { quote, req } = (await find()) ?? notFound() // read again after the lock: a concurrent accept has committed by now
  if (quote.status === 'expired') fail(409, { error: 'quote-expired' }) // e.g. reopened at its expiry (trigger bookings_reopen_request)
  if (quote.status !== 'sent' || req.status !== 'quoted') fail(409, { error: 'quote-not-open' })
  if (quote.expiresAt <= now) fail(409, { error: 'quote-expired' })
  const provider = (await tx.select().from(providers).where(eq(providers.id, req.providerId)))[0]
  if (quote.providerId !== req.providerId) return notFound()
  // a suspended or unpublished provider row is hidden from the customer by RLS: that is unavailable too
  if (!provider || provider.status !== 'published' || (await isSuspendedNow(tx, provider.id))) return unavailable()
  if (!canTransact(provider)) fail(409, { error: 'PROVIDER_NOT_READY' }) // the provider's payouts stopped being ready since the quote
  if (req.parentBookingId) {
    // an additional task: the parent's time and place, awaiting payment at once (additional.ts)
    const child = await acceptAdditional(quote, req, input.note ?? null, now)
    const threadId = await threadForRequest(tx, req.id) // the parent's thread
    afterCommit(() => postCard(threadId, userId, { type: 'acceptance', refId: child.id, amount: Number(child.amount), currency: child.currency as 'EUR' }))
    return toBooking(child, now)
  }
  if (!('startAt' in input)) return fail(400, { error: 'time-required' })
  const startAt = new Date(input.startAt)
  assertFuture(startAt, now)
  if (!input.onSite && !provider.worksRemotely) fail(400, { error: 'on-site-required' })
  await tx.update(quotes).set({ status: 'accepted' }).where(eq(quotes.id, quote.id))
  await tx.update(requests).set({ status: 'booked', updatedAt: now }).where(eq(requests.id, req.id))
  const [row] = await tx
    .insert(bookingAppInsert) // the price comes from the quote (trigger bookings_fill_amount), never from the client
    .values({
      customerId: userId,
      providerId: provider.id,
      serviceId: req.serviceId,
      quoteId: quote.id,
      source: 'quote',
      status: 'proposed',
      startAt,
      durationMin: input.durationMin,
      onSite: input.onSite,
      ...(input.onSite && input.address && { addressStreet: input.address.street ?? null, addressPostcode: input.address.postcode, addressCity: input.address.city ?? null }),
      note: input.note ?? null,
      answerBy: new Date(now.getTime() + PROPOSAL_ANSWER_HOURS * HOUR),
      createdAt: now,
      updatedAt: now,
    })
    .returning(getTableColumns(bookings))
  const threadId = await threadForRequest(tx, req.id)
  afterCommit(() => postCard(threadId, userId, { type: 'acceptance', refId: row!.id, amount: Number(row!.amount), currency: row!.currency as 'EUR' }))
  notifyProposal(afterCommit, provider, row!)
  return toBooking(row!, now)
}
