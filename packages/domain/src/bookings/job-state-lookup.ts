import { and, eq, inArray, isNull, max, or, sql } from 'drizzle-orm'
import { bookings, db, providers, quotes, reviews, staffFlags, type Tx } from '@kando/db'
import type { JobStateDto } from '@kando/contract'
import { threadsOf } from '../chat/threads'
import { readRef } from '../payments/rules'
import { noShowObjectBy } from './ending-rules'
import { currentBookingOf, deriveJobState, type JobBookingInput, type JobRequestInput, type JobState, type JobViewer } from './job-state'

// Imports no requests/notify module (requests.ts imports this one); the thread rule is chat/threads.ts threadsOf.
type Db = Tx | typeof db
type BookingRow = typeof bookings.$inferSelect

/**
 * A state with what the lookup found on the way: unread, the job's chat thread (null: none yet), the item's bookings (oldest
 * first, created_at then id) and the current one (currentBookingOf). Only the state itself leaves the server (toJobStateDto).
 */
export type JobStateOf = JobState & { unread: boolean; threadId: string | null; bookingIds: string[]; currentBookingId: string | null }

/** One DTO to give a state: `key` is how the caller finds it again (request id or booking id). */
export type JobStateItem = { key: string; viewer: JobViewer; providerId: string; requestId: string | null; bookingId?: string; /** a request item: the booking an additional task adds to (its chat is that booking's) */ parentBookingId?: string | null; request: JobRequestInput }

/** An open money flag of the booking: a failed release, settle or refund (kinds written by attemptMoney and the webhook). The text is never read. */
export const MONEY_FLAGS = ['payment-unprocessed', 'refund-failed']

/**
 * The derived job state for each item, in a fixed number of queries (no N+1). The request item sees all bookings of its request, a
 * booking item only its own booking. `x` is the caller's transaction (parties only, by row security); staff flags, payout readiness
 * and the viewer's own notices are read on the owner pool for ids the caller already may see.
 * Unread: the viewer has a `message-received` notice for the job's thread that is neither seen nor dismissed (the chat has no
 * read marker of its own; ponytail: the notice is throttled per thread, so it flags "something new", not a count).
 * `held`: booking rows the caller already read on `x` (a booking item's own row is then not read again).
 * Money flags: a flag on a booking whose dispute is still undecided does not count (the dispute is the problem, spec 4.4); one
 * left by a decided dispute's failing money step does (Delayed).
 */
export async function jobStates(x: Db, userId: string, items: JobStateItem[], now = new Date(), held: BookingRow[] = []): Promise<Map<string, JobStateOf>> {
  const out = new Map<string, JobStateOf>()
  if (!items.length) return out
  const byRequest = [...new Set(items.filter((i) => !i.bookingId && i.requestId).map((i) => i.requestId!))]
  const byId = [...new Set(items.flatMap((i) => i.bookingId ?? []))]
  const have = new Map(held.filter((r) => byId.includes(r.id)).map((r) => [r.id, r]))
  const missing = byId.filter((id) => !have.has(id))
  const where = or(byRequest.length ? inArray(bookings.requestId, byRequest) : undefined, missing.length ? inArray(bookings.id, missing) : undefined)
  const rows = [...new Map([...have.values(), ...(where ? await x.select().from(bookings).where(where) : [])].map((r) => [r.id, r])).values()]
  const bookingIds = rows.map((r) => r.id)

  const providerIds = [...new Set(items.map((i) => i.providerId))]
  const undecided = sql`NOT EXISTS (SELECT 1 FROM disputes d WHERE d.booking_id::text = staff_flags.ref_id AND d.decided_at IS NULL)`
  const [flags, readyRows, reviewedRows] = await Promise.all([
    bookingIds.length ? db.select({ ref: staffFlags.refId }).from(staffFlags).where(and(inArray(staffFlags.kind, MONEY_FLAGS), inArray(staffFlags.refId, bookingIds), isNull(staffFlags.resolvedAt), undecided)) : [],
    db.select({ id: providers.id }).from(providers).where(and(inArray(providers.id, providerIds), sql`${providers.payoutsReadyAt} IS NOT NULL`)),
    // the viewer's own reviews (owner pool, for booking ids the caller already may see): the customer's open rating keeps a completed job under Needs you
    bookingIds.length ? db.select({ id: reviews.bookingId }).from(reviews).where(and(inArray(reviews.bookingId, bookingIds), eq(reviews.authorId, userId))) : [],
  ])
  const reviewed = new Set(reviewedRows.map((r) => r.id))
  const flagged = new Set(flags.map((r) => r.ref))
  const ready = new Set(readyRows.map((r) => r.id))

  // the quote's validity (the latest expiry of its sent quotes), for requests that read "quoted"
  const quotedIds = items.filter((i) => i.request.status === 'quoted' && i.requestId).map((i) => i.requestId!)
  const validUntil = new Map<string, Date>()
  if (quotedIds.length)
    for (const q of await x.select({ requestId: quotes.requestId, until: max(quotes.expiresAt) }).from(quotes).where(and(inArray(quotes.requestId, quotedIds), eq(quotes.status, 'sent'))).groupBy(quotes.requestId))
      if (q.until) validUntil.set(q.requestId, q.until)

  // the job's thread (threadsOf: own, request's, else the parent booking's) and, in the same query, an unseen message notice of the viewer
  const lookups = [
    ...rows.map((r) => ({ key: r.id, bookingId: r.id, requestId: r.requestId, parentBookingId: r.parentBookingId })),
    ...items.filter((i) => i.requestId && !i.bookingId).map((i) => ({ key: `r:${i.requestId}`, bookingId: null, requestId: i.requestId, parentBookingId: i.parentBookingId ?? null })),
  ]
  const threadOf = await threadsOf(x, lookups, userId)
  const unreadKey = (k: string) => !!threadOf.get(k)?.unread
  const oldestFirst = (a: BookingRow, b: BookingRow) => +a.createdAt - +b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

  for (const i of items) {
    const mine = rows.filter((r) => (i.bookingId ? r.id === i.bookingId : r.requestId === i.requestId)).sort(oldestFirst)
    const inputs: JobBookingInput[] = mine.map((r) => ({ ...r, ...(() => { const c = readRef(r.checkoutRef); return { checkoutStartedAt: c?.startedAt ? new Date(c.startedAt) : null, checkoutExpiresAt: c?.expiresAt ? new Date(c.expiresAt) : null } })(), noShowObjectBy: noShowObjectBy(r.noShowReportedAt), reviewedByCustomer: i.viewer === 'customer' && reviewed.has(r.id) }))
    const current = currentBookingOf(inputs)
    const unread = (!!i.requestId && !i.bookingId && unreadKey(`r:${i.requestId}`)) || mine.some((r) => unreadKey(r.id))
    out.set(i.key, {
      unread,
      threadId: threadOf.get(i.bookingId ?? `r:${i.requestId}`)?.id ?? null,
      bookingIds: mine.map((r) => r.id),
      currentBookingId: current?.id ?? null,
      ...deriveJobState({
        viewer: i.viewer,
        request: { ...i.request, quoteValidUntil: i.requestId ? validUntil.get(i.requestId) ?? null : null },
        bookings: inputs,
        delayedFlag: !!current && flagged.has(current.id),
        providerPayoutReady: ready.has(i.providerId),
        unread,
        now,
      }),
    })
  }
  return out
}

/** The state as the API sends it (dates as ISO text). */
export const toJobStateDto = ({ paidOutAt, startAt, unread: _u, threadId: _t, bookingIds: _b, currentBookingId: _c, ...s }: JobState & Partial<Omit<JobStateOf, keyof JobState>>): JobStateDto => ({ ...s, ...(paidOutAt && { paidOutAt: paidOutAt.toISOString() }), ...(startAt && { startAt: startAt.toISOString() }) })
