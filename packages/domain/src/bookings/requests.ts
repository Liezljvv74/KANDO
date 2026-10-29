import { and, desc, eq, sql } from 'drizzle-orm'
import { bookings, db, providers, quotes, requests, type Tx } from '@kando/db'
import type { AcceptQuoteInput, Booking, BookingRequest, Quote, QuoteInput, RequestInput } from '@kando/contract'
import { runDueTimersFor } from './timers'
import { isUuid } from '../admin/common'
import { offerableServiceIds } from '../providers/eligibility'
import { fail } from '../providers/http'
import { isSuspendedNow, ownProvider } from '../providers/profile'
import { assertFuture, PROPOSAL_ANSWER_HOURS, QUOTE_VALID_DAYS, REQUEST_ANSWER_DAYS } from './rules'

const DAY = 86_400_000
const HOUR = 3_600_000
const NO_ID = '00000000-0000-0000-0000-000000000000'
const notFound = () => fail(404, { error: 'Not found' })
const iso = (d: Date) => d.toISOString()

const toRequest = (r: typeof requests.$inferSelect): BookingRequest => ({
  id: r.id,
  customerId: r.customerId,
  providerId: r.providerId,
  serviceId: r.serviceId,
  description: r.description,
  preferredDate: r.preferredDate,
  status: r.status as BookingRequest['status'],
  answerBy: iso(r.answerBy),
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
})

export const toQuote = (q: typeof quotes.$inferSelect): Quote => ({
  id: q.id,
  requestId: q.requestId,
  providerId: q.providerId,
  version: q.version,
  amount: Number(q.amount),
  currency: q.currency as Quote['currency'],
  scope: q.scope,
  startAt: q.startAt ? iso(q.startAt) : null,
  durationMin: q.durationMin,
  status: q.status as Quote['status'],
  expiresAt: iso(q.expiresAt),
  createdAt: iso(q.createdAt),
})

/** Null address parts are left out, as the contract has them optional. */
export const toBooking = (b: typeof bookings.$inferSelect): Booking => ({
  id: b.id,
  customerId: b.customerId,
  providerId: b.providerId,
  serviceId: b.serviceId,
  quoteId: b.quoteId,
  source: b.source as Booking['source'],
  status: b.status as Booking['status'],
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
  createdAt: iso(b.createdAt),
  updatedAt: iso(b.updatedAt),
})

/** Serialises actions on one request (two accepts, or an accept and a new quote, cannot interleave). */
const lockRequest = (tx: Tx, requestId: string) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('booking_request'), hashtext(${requestId}))`)

export async function createRequest(tx: Tx, userId: string, input: RequestInput, now = new Date()): Promise<BookingRequest> {
  const provider = (await tx.select().from(providers).where(eq(providers.id, input.providerId)))[0]
  if (!provider || provider.status !== 'published' || (await isSuspendedNow(tx, provider.id))) return notFound()
  const offerable = await offerableServiceIds(tx, provider.id)
  if (!offerable.length) return notFound()
  if (provider.ownerId === userId) fail(400, { error: 'own-service' })
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
  return toRequest(row!)
}

/** The caller's requests, newest first: those they sent (customer) or those addressed to their provider profile. */
export async function listRequests(tx: Tx, userId: string, role: 'customer' | 'provider'): Promise<BookingRequest[]> {
  await runDueTimersFor(db, userId) // the caller's own rows are never stale
  const mine = role === 'customer' ? eq(requests.customerId, userId) : eq(requests.providerId, (await ownProvider(tx, userId))?.id ?? NO_ID)
  return (await tx.select().from(requests).where(mine).orderBy(desc(requests.createdAt), desc(requests.id))).map(toRequest)
}

/** One request; 404 unless the caller is its customer or the provider owner. */
export async function getRequest(tx: Tx, userId: string, id: string): Promise<BookingRequest> {
  const row = isUuid(id) ? (await tx.select().from(requests).where(eq(requests.id, id)))[0] : undefined
  if (!row) return notFound()
  if (row.customerId !== userId && (await ownProvider(tx, userId))?.id !== row.providerId) return notFound()
  return toRequest(row)
}

/** Quotes of a request, newest version first, for either party. */
export async function listQuotes(tx: Tx, userId: string, requestId: string): Promise<Quote[]> {
  await getRequest(tx, userId, requestId)
  return (await tx.select().from(quotes).where(eq(quotes.requestId, requestId)).orderBy(desc(quotes.version))).map(toQuote)
}

const unavailable = () => fail(409, { error: 'provider-unavailable' })

export async function sendQuote(tx: Tx, userId: string, requestId: string, input: QuoteInput, now = new Date()): Promise<Quote> {
  const provider = (await ownProvider(tx, userId)) ?? notFound()
  if (!isUuid(requestId)) return notFound()
  const own = () => tx.select().from(requests).where(and(eq(requests.id, requestId), eq(requests.providerId, provider.id)))
  if (!(await own())[0]) return notFound() // party check before the lock: a stranger cannot make anyone wait
  await lockRequest(tx, requestId)
  const req = (await own())[0]! // read again after the lock
  if (provider.status !== 'published' || (await isSuspendedNow(tx, provider.id))) unavailable()
  if (!['open', 'quoted'].includes(req.status)) fail(409, { error: 'request-closed' })
  // The 3-day answer deadline binds the first quote only; a revision may follow while the last quote is still valid.
  const open = (await tx.select({ e: quotes.expiresAt }).from(quotes).where(and(eq(quotes.requestId, requestId), eq(quotes.status, 'sent'))))[0]
  if (open ? open.e <= now : req.answerBy <= now) fail(409, { error: 'request-closed' })
  if (input.startAt) assertFuture(new Date(input.startAt), now)
  const prev = (await tx.select({ v: quotes.version }).from(quotes).where(eq(quotes.requestId, requestId)).orderBy(desc(quotes.version)).limit(1))[0]
  await tx.update(quotes).set({ status: 'superseded' }).where(and(eq(quotes.requestId, requestId), eq(quotes.status, 'sent')))
  const [row] = await tx
    .insert(quotes)
    .values({
      requestId,
      providerId: provider.id,
      version: (prev?.v ?? 0) + 1,
      amount: input.amount.toFixed(2),
      currency: 'EUR', // ponytail: EUR only in v1, as services
      scope: input.scope,
      startAt: input.startAt ? new Date(input.startAt) : null,
      durationMin: input.durationMin ?? null,
      expiresAt: new Date(now.getTime() + QUOTE_VALID_DAYS * DAY),
      createdAt: now,
    })
    .returning()
  await tx.update(requests).set({ status: 'quoted', updatedAt: now }).where(eq(requests.id, requestId))
  return toQuote(row!)
}

export async function acceptQuote(tx: Tx, userId: string, quoteId: string, input: AcceptQuoteInput, now = new Date()): Promise<Booking> {
  const find = async () => {
    const q = isUuid(quoteId) ? (await tx.select().from(quotes).where(eq(quotes.id, quoteId)))[0] : undefined
    const r = q && (await tx.select().from(requests).where(and(eq(requests.id, q.requestId), eq(requests.customerId, userId))))[0] // only the request's customer
    return q && r ? { quote: q, req: r } : null
  }
  const pre = (await find()) ?? notFound() // party check before the lock: a stranger cannot make anyone wait
  await lockRequest(tx, pre.req.id)
  const { quote, req } = (await find()) ?? notFound() // read again after the lock: a concurrent accept has committed by now
  if (quote.status !== 'sent' || req.status !== 'quoted') fail(409, { error: 'quote-not-open' })
  if (quote.expiresAt <= now) fail(409, { error: 'quote-expired' })
  const provider = (await tx.select().from(providers).where(eq(providers.id, req.providerId)))[0]
  if (quote.providerId !== req.providerId) return notFound()
  // a suspended or unpublished provider row is hidden from the customer by RLS: that is unavailable too
  if (!provider || provider.status !== 'published' || (await isSuspendedNow(tx, provider.id))) return unavailable()
  const startAt = new Date(input.startAt)
  assertFuture(startAt, now)
  if (!input.onSite && !provider.worksRemotely) fail(400, { error: 'on-site-required' })
  await tx.update(quotes).set({ status: 'accepted' }).where(eq(quotes.id, quote.id))
  await tx.update(requests).set({ status: 'booked', updatedAt: now }).where(eq(requests.id, req.id))
  const [row] = await tx
    .insert(bookings)
    .values({
      customerId: userId,
      providerId: provider.id,
      serviceId: req.serviceId,
      quoteId: quote.id,
      source: 'quote',
      status: 'proposed',
      startAt,
      durationMin: input.durationMin,
      amount: quote.amount, // from the stored quote, never from the client
      currency: quote.currency,
      onSite: input.onSite,
      ...(input.onSite && input.address && { addressStreet: input.address.street ?? null, addressPostcode: input.address.postcode, addressCity: input.address.city ?? null }),
      note: input.note ?? null,
      answerBy: new Date(now.getTime() + PROPOSAL_ANSWER_HOURS * HOUR),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
  return toBooking(row!)
}
