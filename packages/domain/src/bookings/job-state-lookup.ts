import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { bookings, db, notifications, providers, quotes, staffFlags, type Tx } from '@kando/db'
import type { JobStateDto } from '@kando/contract'
import { threadIdsOf } from '../chat/threads'
import { readRef } from '../payments/rules'
import { noShowObjectBy } from './ending-rules'
import { currentBookingOf, deriveJobState, type JobBookingInput, type JobRequestInput, type JobState, type JobViewer } from './job-state'

// Imports no requests/notify module (requests.ts imports this one); the thread rule is chat/threads.ts threadIdsOf.
type Db = Tx | typeof db

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
 */
export async function jobStates(x: Db, userId: string, items: JobStateItem[], now = new Date()): Promise<Map<string, JobState & { unread: boolean }>> {
  const out = new Map<string, JobState & { unread: boolean }>()
  if (!items.length) return out
  const byRequest = [...new Set(items.filter((i) => !i.bookingId && i.requestId).map((i) => i.requestId!))]
  const byId = [...new Set(items.flatMap((i) => i.bookingId ?? []))]
  const where = or(byRequest.length ? inArray(bookings.requestId, byRequest) : undefined, byId.length ? inArray(bookings.id, byId) : undefined)
  const rows = where ? await x.select().from(bookings).where(where) : []
  const bookingIds = rows.map((r) => r.id)

  const providerIds = [...new Set(items.map((i) => i.providerId))]
  const [flags, readyRows] = await Promise.all([
    bookingIds.length ? db.select({ ref: staffFlags.refId }).from(staffFlags).where(and(inArray(staffFlags.kind, MONEY_FLAGS), inArray(staffFlags.refId, bookingIds), isNull(staffFlags.resolvedAt))) : [],
    db.select({ id: providers.id }).from(providers).where(and(inArray(providers.id, providerIds), sql`${providers.payoutsReadyAt} IS NOT NULL`)),
  ])
  const flagged = new Set(flags.map((r) => r.ref))
  const ready = new Set(readyRows.map((r) => r.id))

  // the quote's validity, for requests that read "quoted"
  const quotedIds = items.filter((i) => i.request.status === 'quoted' && i.requestId).map((i) => i.requestId!)
  const validUntil = new Map<string, Date>()
  if (quotedIds.length)
    for (const q of await x.select({ requestId: quotes.requestId, expiresAt: quotes.expiresAt }).from(quotes).where(and(inArray(quotes.requestId, quotedIds), eq(quotes.status, 'sent'))))
      if (!validUntil.has(q.requestId) || q.expiresAt > validUntil.get(q.requestId)!) validUntil.set(q.requestId, q.expiresAt)

  // unread: the job's thread (threadIdsOf: own, request's, else the parent booking's) has an unseen message notice of the viewer
  const lookups = [
    ...rows.map((r) => ({ key: r.id, bookingId: r.id, requestId: r.requestId, parentBookingId: r.parentBookingId })),
    ...items.filter((i) => i.requestId && !i.bookingId).map((i) => ({ key: `r:${i.requestId}`, bookingId: null, requestId: i.requestId, parentBookingId: i.parentBookingId ?? null })),
  ]
  const threadOf = await threadIdsOf(x, lookups)
  const threadIds = [...new Set([...threadOf.values()].flatMap((t) => t ?? []))]
  const open = new Set<string>()
  if (threadIds.length) {
    const notices = await x
      .select({ threadId: sql<string>`${notifications.payload}->>'threadId'` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.kind, 'message-received'), sql`${notifications.payload}->>'threadId' IN (${sql.join(threadIds.map((t) => sql`${t}`), sql`, `)})`, isNull(notifications.seenAt), isNull(notifications.dismissedAt)))
    for (const n of notices) open.add(n.threadId)
  }
  const unreadKey = (k: string) => { const t = threadOf.get(k); return !!t && open.has(t) }

  for (const i of items) {
    const mine = rows.filter((r) => (i.bookingId ? r.id === i.bookingId : r.requestId === i.requestId))
    const inputs: JobBookingInput[] = mine.map((r) => ({ ...r, ...(() => { const c = readRef(r.checkoutRef); return { checkoutStartedAt: c?.startedAt ? new Date(c.startedAt) : null, checkoutExpiresAt: c?.expiresAt ? new Date(c.expiresAt) : null } })(), noShowObjectBy: noShowObjectBy(r.noShowReportedAt) }))
    const current = currentBookingOf(inputs)
    const unread = (!!i.requestId && !i.bookingId && unreadKey(`r:${i.requestId}`)) || mine.some((r) => unreadKey(r.id))
    out.set(i.key, {
      unread,
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
export const toJobStateDto = ({ paidOutAt, startAt, unread: _unread, ...s }: JobState & { unread?: boolean }): JobStateDto => ({ ...s, ...(paidOutAt && { paidOutAt: paidOutAt.toISOString() }), ...(startAt && { startAt: startAt.toISOString() }) })
