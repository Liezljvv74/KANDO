import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import { bookings, db, providers, quotes, requestAppInsert, requests, services, type Tx } from '@kando/db'
import { DAY, LIST_PAGE, type AcceptQuoteInput, type Booking, type BookingRequest, type LapseReason, type Page, type Quote, type QuoteInput, type RequestInput, type TimeProposal } from '@kando/contract'
import type { AfterCommit } from '../app-request'
import { blockedWithProvider } from '../chat/blocks'
import { assertNoContactDetails } from '../chat/flags'
import { postCard } from '../chat/messages'
import { threadForRequest } from '../chat/threads'
import { olderThan, pageOf, stampOf } from '../paging'
import { notifyBookingEvent } from './notify'
import { timeIsAcceptable } from './busy'
import { isUuid, NO_ID } from '../admin/common'
import { offerableServiceIds } from '../providers/eligibility'
import { fail, notFound } from '../providers/http'
import { isSuspendedNow, ownProvider } from '../providers/profile'
import { issueQuoteDocument } from '../quotes/issue'
import { canTransact } from '../payments/rules'
import { assertFuture, bookingShownStatus, lapseReason, MAX_OPEN_REQUESTS_PER_PAIR, MAX_REQUESTS_PER_DAY, QUOTE_VALID_DAYS, REQUEST_ANSWER_DAYS } from './rules'
import { acceptAdditional } from './additional'
import { noShowObjectBy } from './ending-rules'
import { expireLapsedRoot } from './timers'
import { ratingsOf } from '../reviews'
import { taskNumber } from './job-ref'
import { rootJobs, rootRequestId, rootsOf, taskPositions } from './job-lookup'
import { jobStates, toJobStateDto, type JobStateItem, type JobStateOf } from './job-state-lookup'
import { jobsForNotices } from './notice-job'

type Db = Tx | typeof db

const iso = (d: Date) => d.toISOString()

/**
 * The mappers show a lapsed row as expired (reads never write; the daily cron does): see bookingShownStatus. `lapse`: the
 * request's root booking lapsed (lapsedRoots), so the rows read as trigger bookings_reopen_request will write them; `lapsed` on the
 * request is its reason while the job reads open again and the quote it came from can still be booked (the app asks "still want it?").
 */
export const toRequest = (r: typeof requests.$inferSelect, now = new Date(), lapse?: Lapse): BookingRequest => {
  const status = lapse && r.status === 'booked' ? 'quoted' : r.status
  return {
    id: r.id,
    customerId: r.customerId,
    providerId: r.providerId,
    serviceId: r.serviceId,
    description: r.description,
    startAt: r.startAt ? iso(r.startAt) : null,
    durationMin: r.durationMin,
    onSite: r.onSite,
    address: r.addressPostcode
      ? { postcode: r.addressPostcode, ...(r.addressStreet && { street: r.addressStreet }), ...(r.addressCity && { city: r.addressCity }) }
      : null,
    note: r.note,
    revision: r.revision,
    parentBookingId: r.parentBookingId,
    jobNumber: r.jobNumber,
    status: (status === 'open' && r.answerBy <= now ? 'expired' : status) as BookingRequest['status'],
    lapsed: status === 'quoted' && lapse?.open ? lapse.reason : null, // the provider's view carries it too; only the customer's app asks
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

/** A request's lapsed root booking: its quote, why it lapsed, and whether that quote can still be booked (sent or accepted, and valid). */
type Lapse = { quoteId: string | null; reason: LapseReason; open: boolean }

/**
 * Request id > lapse, for each request whose latest root booking reads expired (not yet written by the timer, or written already):
 * the job reads open again (no write). One query for all the requests; only the latest root booking of a request counts, so a job
 * booked again after a lapse is not lapsed.
 */
export async function lapsedRoots(tx: Tx, requestIds: string[], now: Date): Promise<Map<string, Lapse>> {
  const out = new Map<string, Lapse>()
  if (!requestIds.length) return out
  const roots = await tx
    .select({ requestId: bookings.requestId, quoteId: bookings.quoteId, status: bookings.status, answerBy: bookings.answerBy, payBy: bookings.payBy, quoteStatus: quotes.status, expiresAt: quotes.expiresAt })
    .from(bookings)
    .leftJoin(quotes, eq(quotes.id, bookings.quoteId))
    .where(and(inArray(bookings.requestId, requestIds), isNull(bookings.parentBookingId), inArray(bookings.status, ['awaiting-time', 'awaiting-payment', 'expired'])))
    .orderBy(desc(bookings.createdAt))
  const seen = new Set<string>()
  for (const b of roots) {
    if (seen.has(b.requestId!)) continue
    seen.add(b.requestId!)
    const reason = lapseReason(b, now)
    if (reason) out.set(b.requestId!, { quoteId: b.quoteId, reason, open: (b.quoteStatus === 'accepted' || b.quoteStatus === 'sent') && b.expiresAt! > now })
  }
  return out
}

/** The job-state lookup item of a request DTO (key: its id) or a booking DTO (key: its id), as `userId` sees it. */
const requestItem = (r: BookingRequest, userId: string): JobStateItem => ({ key: r.id, viewer: r.customerId === userId ? 'customer' : 'provider', providerId: r.providerId, requestId: r.id, parentBookingId: r.parentBookingId, request: { status: r.status, answerBy: new Date(r.answerBy) } })
export const bookingItem = (b: Booking, userId: string): JobStateItem => ({ key: b.id, viewer: b.customerId === userId ? 'customer' : 'provider', providerId: b.providerId, requestId: b.requestId, bookingId: b.id, request: { status: 'booked', answerBy: null } })

/**
 * Adds the root job's number and title to request DTOs (an additional task's request shows its job's). `withState`: true adds
 * the derived job state (reads only, the phone reloads after an action); a map hands in states the caller already looked up.
 */
export async function withRequestRefs<T extends BookingRequest>(x: Db, list: T[], userId?: string, withState: boolean | Map<string, JobStateOf> = false): Promise<T[]> {
  const parents = [...new Set(list.flatMap((r) => (r.parentBookingId ? [r.parentBookingId] : [])))]
  const roots = await rootsOf(x, parents)
  // a task whose root booking has no request (booked direct) has no job to show: no refs, never its own unused number
  const rootOf = (r: T) => rootRequestId(r, roots)
  const jobs = await rootJobs(x, [...new Set(list.flatMap((r) => rootOf(r) ?? []))], userId)
  // the derived job state, as seen by the caller
  const states = withState instanceof Map ? withState : userId && withState ? await jobStates(x, userId, list.map((r) => requestItem(r, userId))) : undefined
  return list.map((r) => {
    const root = rootOf(r)
    const j = root ? jobs.get(root) : undefined
    const s = states?.get(r.id)
    const withState = s ? { ...r, jobState: toJobStateDto(s) } : r
    if (j) return { ...withState, jobNumber: j.jobNumber, title: j.title }
    if (r.parentBookingId) { const { jobNumber: _own, title: _t, ...rest } = withState; return rest as T } // a task with no root request: not its own unused number
    return withState
  })
}

/**
 * Adds the job number, title and task number to booking DTOs. A job is its root booking plus the additional tasks that hang
 * below it (by parent_booking_id); the root booking is `#1040`, its tasks are `#1040-2`, `#1040-3` in the order they were created
 * (created_at, id), every status counted (bookings are never deleted, so a position never changes), whichever batch shows them.
 */
export async function withBookingRefs(x: Db, list: Booking[], userId?: string, withState: boolean | Map<string, JobStateOf> = false): Promise<Booking[]> {
  // the derived job state of each booking itself, as seen by the caller (`withState` as in withRequestRefs)
  const states = withState instanceof Map ? withState : userId && withState && list.length ? await jobStates(x, userId, list.map((b) => bookingItem(b, userId))) : undefined
  const stated = (b: Booking): Booking => { const s = states?.get(b.id); return s ? { ...b, jobState: toJobStateDto(s) } : b }
  if (!list.some((b) => b.requestId)) return list.map(stated)
  const roots = await rootsOf(x, list.filter((b) => b.requestId).map((b) => b.id))
  const rootReqs = [...new Set([...roots.values()].flatMap((r) => r.requestId ?? []))]
  const jobs = await rootJobs(x, rootReqs, userId)
  const position = await taskPositions(x, rootReqs)
  return list.map((b) => {
    const rr = roots.get(b.id)?.requestId
    const j = rr ? jobs.get(rr) : undefined
    return j ? { ...stated(b), jobNumber: j.jobNumber, title: j.title, taskNumber: taskNumber(j.jobNumber, position.get(b.id) ?? 1) } : stated(b)
  })
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
  pendingTime:
    b.status === 'awaiting-time' && b.timeProposedBy && b.timeProposedStartAt && b.timeProposedDurationMin !== null && b.timeAnswerBy && b.timeAnswerBy > now
      ? { by: b.timeProposedBy as 'customer' | 'provider', startAt: iso(b.timeProposedStartAt), durationMin: b.timeProposedDurationMin, onSite: b.timeProposedOnSite ?? true, answerBy: iso(b.timeAnswerBy) }
      : null,
  finishedAt: b.finishedAt ? iso(b.finishedAt) : null,
  confirmBy: b.confirmBy ? iso(b.confirmBy) : null,
  askedDoneAt: b.askedDoneAt ? iso(b.askedDoneAt) : null,
  cancelledAt: b.cancelledAt ? iso(b.cancelledAt) : null,
  cancelledBy: b.cancelledBy as Booking['cancelledBy'],
  lateCancel: b.lateCancel,
  noShow: b.noShow as Booking['noShow'],
  noShowReportedAt: b.noShowReportedAt ? iso(b.noShowReportedAt) : null,
  noShowObjectBy: b.noShowReportedAt ? iso(noShowObjectBy(b.noShowReportedAt)!) : null,
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
export const lockRequest = (tx: Tx, requestId: string) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('booking_request'), hashtext(${requestId}))`)

/**
 * Abuse limits, checked before anything is saved. The customer's advisory lock (held to the end of the transaction) makes two
 * parallel creates take turns, so both cannot pass. The customer reads all their own rows, so the caller's tx counts them.
 * The messages say nothing about other people. At most MAX_OPEN_REQUESTS_PER_PAIR (5) open requests per customer and provider, and MAX_REQUESTS_PER_DAY a day; `providerId` is null when the given id is no valid id (only the daily limit applies; the create then fails as not found).
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
  if (r >= MAX_REQUESTS_PER_DAY) fail(409, { error: 'daily-limit' })
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
  // flow 1: the request carries the customer's time and place (the schema makes them all-or-nothing)
  const { startAt: wanted, durationMin, onSite } = input
  if (wanted === undefined || durationMin === undefined || onSite === undefined) return fail(400, { error: 'time-required' })
  const startAt = new Date(wanted)
  await timeIsAcceptable(tx, { providerId: provider.id, startAt, durationMin, onSite, now, clash: false })
  if (input.note) await assertNoContactDetails(userId, input.note)
  const [created] = await tx
    .insert(requestAppInsert) // job_number is numbered by the database, the app role has no grant on it
    .values({
      customerId: userId,
      providerId: provider.id,
      serviceId: input.serviceId ?? null,
      categoryId: input.serviceId ? (await tx.select({ c: services.categoryId }).from(services).where(eq(services.id, input.serviceId)))[0]?.c ?? null : null,
      description: input.description,
      startAt,
      durationMin,
      onSite,
      ...placeColumns({ onSite, address: input.address }),
      note: input.note ?? null,
      answerBy: new Date(now.getTime() + REQUEST_ANSWER_DAYS * DAY),
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: requestAppInsert.id })
  const [row] = await tx.select().from(requests).where(eq(requests.id, created!.id))
  await threadForRequest(tx, row!.id) // the chat opens with the request
  afterCommit(() => notifyBookingEvent('request-received', provider.ownerId, { requestId: row!.id }))
  return (await withRequestRefs(tx, [toRequest(row!, now)], userId))[0]!
}

/** The job place as the request and booking rows store it: street, postcode and city of an on-site job, none for a remote one. */
const placeColumns = (t: Pick<TimeProposal, 'onSite' | 'address'>) =>
  t.onSite && t.address ? { addressStreet: t.address.street ?? null, addressPostcode: t.address.postcode, addressCity: t.address.city ?? null } : { addressStreet: null, addressPostcode: null, addressCity: null }

/** What the provider may see of a request before the customer confirms: postcode and city, never the street (as for bookings, view in bookings.ts). */
const hideStreet = (r: BookingRequest): BookingRequest => {
  if (!r.address?.street) return r
  const { street: _street, ...place } = r.address
  return { ...r, address: place }
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
  const list = await withRequestRefs(tx, rows.map(({ r }) => toRequest(r, now, lapsed.get(r.id))), userId, true)
  return { docs: role === 'provider' ? await withCustomerRatings(tx, list.map(hideStreet)) : list, next }
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
  const base = toRequest(row, now, (await lapsedRoots(tx, [row.id], now)).get(row.id))
  // one lookup gives the state, the chat (an additional task talks in its booking's thread), this request's bookings (oldest first) and the current one
  const states = await jobStates(tx, userId, [requestItem(base, userId)])
  const s = states.get(row.id)!
  const otherParty = (await jobsForNotices(tx, userId, [{ requestId: row.id }]))[0]?.otherParty
  const job = { bookingIds: s.bookingIds, currentBookingId: s.currentBookingId, ...(otherParty !== undefined && { otherParty }) }
  const dto = { ...(await withRequestRefs(tx, [base], userId, states))[0]!, threadId: s.threadId, ...job }
  return row.customerId === userId ? dto : (await withCustomerRatings(tx, [hideStreet(dto)]))[0]!
}

/** Quotes of a request, newest version first, for either party. */
export async function listQuotes(tx: Tx, userId: string, requestId: string, now = new Date()): Promise<Quote[]> {
  await ownRequest(tx, userId, requestId)
  const reopened = (await lapsedRoots(tx, [requestId], now)).get(requestId)?.quoteId
  return (await tx.select().from(quotes).where(eq(quotes.requestId, requestId)).orderBy(desc(quotes.version))).map((q) => toQuote(q, now, q.id === reopened))
}

const unavailable = () => fail(409, { error: 'provider-unavailable' })

/**
 * The customer changes an OPEN request (flow 1), before any quote exists. A change of start, duration or place kind
 * restarts the provider's answer period and tells the provider; changing only the
 * address or note is free. Once a quote was sent (status quoted) the customer cannot change the request (409 quote-sent): changes go
 * through the chat and the provider's revised quote. The writes run on the owner connection after the checks, under the request
 * lock. 404 for a stranger, 403 for the provider, 409 request-closed for a closed or lapsed request.
 */
export async function reviseRequest(tx: Tx, userId: string, requestId: string, input: TimeProposal, now = new Date(), afterCommit: AfterCommit = () => {}): Promise<BookingRequest> {
  const first = await ownRequest(tx, userId, requestId)
  if (first.customerId !== userId) fail(403, { error: 'wrong-side' })
  await lockRequest(tx, requestId)
  const row = (await tx.select().from(requests).where(eq(requests.id, requestId)))[0] ?? notFound() // read again after the lock
  if (row.status === 'quoted') fail(409, { error: 'quote-sent' }) // a sent quote is final for the customer: changes go through the chat and the provider's revised quote
  if (row.parentBookingId || row.status !== 'open' || row.answerBy <= now) fail(409, { error: 'request-closed' })
  if (await blockedWithProvider(tx, userId, row.providerId)) fail(403, { error: 'BLOCKED' })
  const provider = (await tx.select().from(providers).where(eq(providers.id, row.providerId)))[0] ?? notFound()
  if (provider.status !== 'published' || (await isSuspendedNow(tx, provider.id))) unavailable()
  const startAt = new Date(input.startAt)
  const place = placeColumns(input)
  const timeChanged = row.startAt?.getTime() !== startAt.getTime() || row.durationMin !== input.durationMin || row.onSite !== input.onSite
  const otherChange =
    row.note !== (input.note ?? null) || (row.addressStreet ?? null) !== place.addressStreet || (row.addressPostcode ?? null) !== place.addressPostcode || (row.addressCity ?? null) !== place.addressCity
  if (!timeChanged && !otherChange) return (await withRequestRefs(tx, [toRequest(row, now)], userId))[0]!
  if (input.note) await assertNoContactDetails(userId, input.note)
  if (timeChanged) {
    await timeIsAcceptable(tx, { providerId: provider.id, startAt, durationMin: input.durationMin, onSite: input.onSite, now, clash: false })
  }
  const updated = await db.transaction(async (o) => {
    const [r] = await o
      .update(requests)
      .set({
        startAt,
        durationMin: input.durationMin,
        onSite: input.onSite,
        ...place,
        note: input.note ?? null,
        updatedAt: now,
        ...(timeChanged && { revision: row.revision + 1, revisedAt: now, status: 'open', answerBy: new Date(now.getTime() + REQUEST_ANSWER_DAYS * DAY) }),
      })
      .where(eq(requests.id, requestId))
      .returning()
    return r!
  })
  if (timeChanged) afterCommit(() => notifyBookingEvent('request-updated', provider.ownerId, { requestId }))
  return (await withRequestRefs(tx, [toRequest(updated, now)], userId))[0]!
}

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
  if (!['open', 'quoted'].includes(req.status)) fail(409, { error: 'request-closed-provider' })
  // The 3-day answer deadline binds the first quote only; a revision may follow while the last quote is still valid.
  const open = (await tx.select({ e: quotes.expiresAt }).from(quotes).where(and(eq(quotes.requestId, requestId), eq(quotes.status, 'sent'))))[0]
  if (open ? open.e <= now : req.answerBy <= now) fail(409, { error: 'request-closed-provider' })
  // flow 1: an ordinary request's quote may carry a time (checked like any offered time, clash included) or none ("to be confirmed").
  // A time other than the request's is the provider's proposal under the round rule. An additional task keeps its old rules.
  const startAt = input.startAt ? new Date(input.startAt) : null
  const ordinary = !req.parentBookingId
  const proposedOtherTime = ordinary && startAt !== null && (req.startAt?.getTime() !== startAt.getTime() || req.durationMin !== input.durationMin)
  if (startAt) {
    if (ordinary) await timeIsAcceptable(tx, { providerId: provider.id, startAt, durationMin: input.durationMin!, onSite: req.onSite ?? true, now })
    else assertFuture(startAt, now)
  }
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
      startAt,
      durationMin: input.durationMin ?? null,
      proposedOtherTime,
      // valid for 7 days, but never past the time it offers
      expiresAt: new Date(Math.min(now.getTime() + QUOTE_VALID_DAYS * DAY, startAt?.getTime() ?? Infinity)),
      createdAt: now,
    })
    .returning()
  await tx.update(requests).set({ status: 'quoted', updatedAt: now }).where(eq(requests.id, requestId))
  const threadId = await threadForRequest(tx, requestId)
  // an additional task's quote shows as the additional-task card (with the explainer in the app)
  afterCommit(() => postCard(threadId, userId, req.parentBookingId ? { type: 'additional-task', refId: row!.id, amount: input.amount, currency: row!.currency as 'EUR' } : { type: 'quote', refId: row!.id, amount: input.amount, currency: row!.currency as 'EUR', version: row!.version }))
  afterCommit(() => notifyBookingEvent(proposedOtherTime ? 'time-proposed' : 'quote-received', req.customerId, { requestId, quoteId: row!.id, date: iso(row!.expiresAt) }))
  if (ordinary) afterCommit(async () => void (await issueQuoteDocument(row!.id, now))) // the numbered quote and its PDF (a revision keeps the number, adds _Rev.N)
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
  if (side !== by) fail(403, { error: 'wrong-side' })
  const closedError = by === 'customer' ? 'request-closed' : 'request-closed-provider' // the provider's text does not tell them to send a new request
  await lockRequest(tx, requestId)
  if (first.status === 'booked') await expireLapsedRoot(requestId, now) // a lapsed proposal gives the job back first
  const req = await read() // read again after the lock
  // a lapsed open request is the cron's to expire (it counts toward requests-ignored), never withdrawn or declined
  if (!['open', 'quoted'].includes(req.status) || (req.status === 'open' && req.answerBy <= now)) fail(409, { error: closedError })
  // the timers' expiry takes no request lock: it may commit after the read, so the UPDATE re-checks the status
  const [row] = await tx
    .update(requests)
    .set({ status: by === 'customer' ? 'withdrawn' : 'declined', updatedAt: now })
    .where(and(eq(requests.id, requestId), inArray(requests.status, ['open', 'quoted'])))
    .returning()
  if (!row) fail(409, { error: closedError })
  afterCommit(async () => {
    if (by === 'provider') return notifyBookingEvent('request-declined', req.customerId, { requestId })
    // the owner connection: RLS may hide a suspended provider's row from its customer
    const owner = (await db.select({ id: providers.ownerId }).from(providers).where(eq(providers.id, req.providerId)))[0]
    if (owner) await notifyBookingEvent('request-withdrawn', owner.id, { requestId })
  })
  // The provider declining must not read the customer's street (it is shown only after the customer confirms), like every other provider-facing answer.
  const dto = (await withRequestRefs(tx, [toRequest(row!, now)], userId))[0]!
  return by === 'provider' ? (await withCustomerRatings(tx, [hideStreet(dto)]))[0]! : dto
}

export const withdrawRequest = (tx: Tx, userId: string, requestId: string, now = new Date(), afterCommit: AfterCommit = () => {}): Promise<BookingRequest> =>
  closeRequest(tx, userId, requestId, 'customer', now, afterCommit)

export const declineRequest = (tx: Tx, userId: string, requestId: string, now = new Date(), afterCommit: AfterCommit = () => {}): Promise<BookingRequest> =>
  closeRequest(tx, userId, requestId, 'provider', now, afterCommit)

/**
 * The customer accepts an additional task's quote: the parent booking's time and place, awaiting payment at once (additional.ts).
 * An ordinary quote is confirmed with confirmQuote (confirm.ts), which calls this for an additional task: 409 `use-confirm` here.
 */
export async function acceptQuote(tx: Tx, userId: string, quoteId: string, input: AcceptQuoteInput, now = new Date(), afterCommit: AfterCommit = () => {}): Promise<Booking> {
  const find = async () => {
    const q = isUuid(quoteId) ? (await tx.select().from(quotes).where(eq(quotes.id, quoteId)))[0] : undefined
    const r = q && (await tx.select().from(requests).where(and(eq(requests.id, q.requestId), eq(requests.customerId, userId))))[0] // only the request's customer
    return q && r ? { quote: q, req: r } : null
  }
  const pre = (await find()) ?? notFound() // party check before the lock: a stranger cannot make anyone wait
  if (!pre.req.parentBookingId) fail(409, { error: 'use-confirm' })
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
  const child = await acceptAdditional(quote, req, input.note ?? null, now)
  const threadId = await threadForRequest(tx, req.id) // the parent's thread
  afterCommit(() => postCard(threadId, userId, { type: 'acceptance', refId: child.id, amount: Number(child.amount), currency: child.currency as 'EUR' }))
  return (await withBookingRefs(tx, [toBooking(child, now)], userId))[0]!
}
