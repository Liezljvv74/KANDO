import { and, desc, eq, inArray, isNull, not, notInArray, or, sql } from 'drizzle-orm'
import { bookings, db, notifications, requests, staffFlags, threads, type Tx } from '@kando/db'
import { LIST_PAGE, type JobRow, type JobsPage } from '@kando/contract'
import { isUuid, NO_ID } from '../admin/common'
import { olderThan, pageOf, stampOf } from '../paging'
import { ownProvider } from '../providers/profile'
import { rootsOf, taskRequestsOf } from './job-lookup'
import { REVIEW_VISIBLE_DAYS } from './ending-rules'
import { taskNumber } from './job-ref'
import { leadState, type JobSection } from './job-state'
import { jobStates, MONEY_FLAGS, toJobStateDto } from './job-state-lookup'
import { jobsForNotices } from './notice-job'
import { lapsedRoots, toRequest } from './requests'

export type JobsQueryInput = { role: 'customer' | 'provider'; section: JobSection; search?: string; cursor?: string }

/**
 * The job's date, the list's order and cursor key: the current booking's start (a live booking first, newest; else the newest:
 * currentBookingOf in SQL), else the request's wished time, else when it was made. The column names are written out with their
 * table: inside a select list Drizzle leaves them bare, and a bare "id" in the subquery would be the booking's.
 * ponytail: an expression, so no index orders it; fine for one person's jobs, a stored date column if lists get long.
 */
const jobDate = sql`COALESCE((SELECT b.start_at FROM bookings b WHERE b.request_id = "requests"."id"
  ORDER BY b.status IN ('expired', 'declined', 'withdrawn', 'cancelled', 'refunded'), b.created_at DESC, b.id DESC LIMIT 1), "requests"."start_at", "requests"."created_at")`

type Found = { r: typeof requests.$inferSelect; ts: string; id: string }
const columns = { r: requests, ts: stampOf(jobDate), id: requests.id }
const newestFirst = [desc(jobDate), desc(requests.id)]
const byKeyDesc = (a: { ts: string; id: string }, b: { ts: string; id: string }) => (a.ts !== b.ts ? (a.ts < b.ts ? 1 : -1) : a.id < b.id ? 1 : -1)
/** The in-code twin of `olderThan`: the row comes after the cursor in a newest-first (ts, id) list. */
const afterCursor = (cursor?: string) => (x: { ts: string; id: string }) => {
  if (!cursor) return true
  const [ts, id] = cursor.split('|') as [string, string]
  return x.ts < ts || (x.ts === ts && x.id < id)
}

/**
 * A job whose state is settled for good, decided in SQL so the Past section pages in the database (spec 4.2, plan 6b(a)). It
 * mirrors deriveJobState's past outcomes (a completed root job that either side has not yet rated within REVIEW_VISIBLE_DAYS is not settled: Needs you for the side that has not rated; the other side is derived to past in code, a superset) from the stored columns: no booking of the request is live (every one dead, or completed
 * with the money released), and the request ran out (expired, withdrawn, declined; open past its answer date; quoted with every
 * sent quote expired) or its newest booking is completed, cancelled or refunded. It is a SUBSET of the past: what it misses is in
 * the open set below, derived in code, and merged into the Past page. Money flags and unread messages (read elsewhere) are taken
 * out by the caller.
 */
export const settled = (now: Date) => {
  const at = now.toISOString()
  // one bracket and COALESCE: NOT(...) must negate all of it, and a NULL (no booking) must read false, never drop the row from both lists
  return sql`COALESCE(NOT EXISTS (SELECT 1 FROM bookings b WHERE b.request_id = ${requests.id} AND (b.status NOT IN ('expired', 'declined', 'withdrawn', 'cancelled', 'refunded', 'completed') OR (b.status = 'completed' AND b.released_at IS NULL)
      OR (b.status = 'completed' AND b.parent_booking_id IS NULL AND b.completed_at + make_interval(days => ${REVIEW_VISIBLE_DAYS}) > ${at}::timestamptz AND (SELECT count(DISTINCT rv.author_role) FROM reviews rv WHERE rv.booking_id = b.id) < 2)))
    AND (${requests.status} IN ('expired', 'withdrawn', 'declined')
      OR (${requests.status} = 'open' AND ${requests.answerBy} <= ${at}::timestamptz)
      OR (${requests.status} = 'quoted' AND EXISTS (SELECT 1 FROM quotes q WHERE q.request_id = ${requests.id} AND q.status = 'sent')
          AND NOT EXISTS (SELECT 1 FROM quotes q WHERE q.request_id = ${requests.id} AND q.status = 'sent' AND q.expires_at > ${at}::timestamptz))
      OR (SELECT b.status FROM bookings b WHERE b.request_id = ${requests.id} ORDER BY b.created_at DESC, b.id DESC LIMIT 1) IN ('completed', 'cancelled', 'refunded')), false)`
}

/**
 * Root request ids that must be derived in code even if `settled` says past: the caller's unread message notices (one lookup:
 * notice > thread > root request), bookings with an open money flag (a failed refund reads "delayed", Active) and jobs with a live
 * additional task (its state may lead the row, leadState). Supersets are fine.
 */
async function alwaysDerived(tx: Tx, userId: string, now: Date): Promise<string[]> {
  // a job whose additional task is still live (the task request itself not settled, by the same rule): the task's state may lead
  const liveTasks = await tx.select({ root: bookings.requestId }).from(requests).innerJoin(bookings, eq(bookings.id, requests.parentBookingId)).where(not(settled(now)))
  const notes = await tx
    .select({ t: sql<string>`${notifications.payload}->>'threadId'` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.kind, 'message-received'), isNull(notifications.seenAt), isNull(notifications.dismissedAt)))
  const threadIds = [...new Set(notes.flatMap((n) => (n.t && isUuid(n.t) ? [n.t] : [])))]
  const ths = threadIds.length ? await tx.select({ requestId: threads.requestId, bookingId: threads.bookingId }).from(threads).where(inArray(threads.id, threadIds)) : []
  const reqIds = ths.flatMap((t) => t.requestId ?? [])
  const reqs = reqIds.length ? await tx.select({ id: requests.id, parent: requests.parentBookingId }).from(requests).where(inArray(requests.id, reqIds)) : []
  // ponytail: reads every unresolved money flag (all users); fine while failed money steps are rare, a join on the caller's bookings if not
  // the flags table is staff-only: read on the owner pool, only ids, then narrowed to the caller's own bookings by rootsOf on `tx`
  const flagged = (await db.select({ ref: staffFlags.refId }).from(staffFlags).where(and(inArray(staffFlags.kind, MONEY_FLAGS), isNull(staffFlags.resolvedAt)))).flatMap((f) => (isUuid(f.ref) ? [f.ref] : []))
  const roots = await rootsOf(tx, [...ths.flatMap((t) => t.bookingId ?? []), ...reqs.flatMap((r) => r.parent ?? []), ...flagged])
  return [...new Set([...reqs.filter((r) => !r.parent).map((r) => r.id), ...[...roots.values()].map((r) => r.requestId), ...liveTasks.flatMap((t) => t.root ?? [])])]
}

/** The list rows of the given root requests, as `role` sees them (state, number, title, other party, date, unread). */
async function rowsOf(tx: Tx, userId: string, role: JobsQueryInput['role'], found: Found[], now: Date): Promise<Map<string, JobRow>> {
  const out = new Map<string, JobRow>()
  if (!found.length) return out
  const ids = found.map((f) => f.id)
  const lapsed = await lapsedRoots(tx, ids, now)
  const tasks = await taskRequestsOf(tx, ids)
  const dtos = [...found.map((f) => toRequest(f.r, now, lapsed.get(f.id))), ...tasks.map((t) => toRequest(t.r, now))]
  const states = await jobStates(tx, userId, dtos.map((r) => ({ key: r.id, viewer: role, providerId: r.providerId, requestId: r.id, parentBookingId: r.parentBookingId, request: { status: r.status, answerBy: new Date(r.answerBy) } })), now)
  const refs = await jobsForNotices(tx, userId, ids.map((requestId) => ({ requestId })))
  found.forEach(({ r, ts }, i) => {
    const root = states.get(r.id)
    const j = refs[i]
    if (!root || !j) return
    const s = leadState(root, tasks.flatMap((t) => (t.root === r.id ? states.get(t.r.id) ?? [] : [])))
    out.set(r.id, { id: r.id, number: j.number, title: j.title, otherParty: j.otherParty, date: new Date(ts).toISOString(), jobState: toJobStateDto(s), unread: s.unread ? 1 : 0, threadId: root.threadId ?? null })
  })
  return out
}

/**
 * The Jobs list (spec 4.2): the caller's jobs (root requests) in `role`, one section at a time; row security shows only the
 * caller's own. The open jobs (not settled, a small set) are all loaded and their section derived in code, which also gives the
 * counters (per job, each role on its own). Past pages in SQL by job date (latest first), merged with open jobs that derive to past; `counts.past` is its total. Needs you
 * and Active come whole (Active: problems and delays first). A search covers all sections of the role: number, title, other party.
 */
export async function listJobs(tx: Tx, userId: string, q: JobsQueryInput, now = new Date()): Promise<JobsPage> {
  const mine = q.role === 'customer' ? eq(requests.customerId, userId) : eq(requests.providerId, (await ownProvider(tx, userId))?.id ?? NO_ID)
  const jobsOf = and(mine, isNull(requests.parentBookingId)) // an additional task is part of its job, not a row
  const derived = await alwaysDerived(tx, userId, now)
  const open = await tx.select(columns).from(requests).where(and(jobsOf, or(not(settled(now)), derived.length ? inArray(requests.id, derived) : undefined))).orderBy(...newestFirst)
  const openRows = await rowsOf(tx, userId, q.role, open, now)
  const openList = open.flatMap((f) => openRows.get(f.id) ?? [])
  const pastOutside = and(jobsOf, settled(now), derived.length ? notInArray(requests.id, derived) : undefined)
  const settledCount = (await tx.select({ n: sql<number>`count(*)::int` }).from(requests).where(pastOutside))[0]!.n
  const counts = {
    needsYou: openList.filter((r) => r.jobState.countsForMe).length,
    unread: openList.filter((r) => r.unread).length,
    past: settledCount + openList.filter((r) => r.jobState.section === 'past').length,
  }

  if (q.search) {
    // ponytail: the search reads every job of the role to match names and titles made on the server; a search index if it gets slow
    const needle = q.search.toLowerCase()
    const all = await tx.select(columns).from(requests).where(and(jobsOf, olderThan(jobDate, requests.id, q.cursor))).orderBy(...newestFirst)
    const refs = await jobsForNotices(tx, userId, all.map((f) => ({ requestId: f.id })))
    const hits = all.filter((_, i) => { const j = refs[i]; return !!j && `${taskNumber(j.number, 1)} ${j.title} ${j.otherParty}`.toLowerCase().includes(needle) })
    const { rows, next } = pageOf(hits.slice(0, LIST_PAGE + 1))
    const known = await rowsOf(tx, userId, q.role, rows.filter((f) => !openRows.has(f.id)), now)
    return { items: rows.flatMap((f) => openRows.get(f.id) ?? known.get(f.id) ?? []), ...(next && { next }), counts }
  }

  if (q.section !== 'past') {
    const items = openList.filter((r) => r.jobState.section === q.section)
    if (q.section === 'active') items.sort((a, b) => Number(b.jobState.tone === 'bad') - Number(a.jobState.tone === 'bad')) // stable: newest first within
    return { items, counts }
  }

  const fromDb = await tx
    .select(columns)
    .from(requests)
    .where(and(pastOutside, olderThan(jobDate, requests.id, q.cursor)))
    .orderBy(...newestFirst)
    .limit(LIST_PAGE + 1)
  const fromOpen = open.filter((f) => openRows.get(f.id)?.jobState.section === 'past').filter(afterCursor(q.cursor))
  const { rows, next } = pageOf([...fromDb, ...fromOpen].sort(byKeyDesc).slice(0, LIST_PAGE + 1))
  const settledRows = await rowsOf(tx, userId, q.role, rows.filter((f) => !openRows.has(f.id)), now)
  // `settled` is a hand-made twin of deriveJobState and decides the section (membership of Past), so a job is in exactly one list and
  // the counters equal the lists. A row it calls past that derives otherwise would be a bug in the rule: it stays visible in Past (never
  // dropped) and is logged once per call (ids only) so the rule gets fixed. Inputs the SQL cannot see (unread messages, money flags,
  // live tasks) are not drift: alwaysDerived moves those jobs to the code-derived set before `settled` is applied.
  const drift = [...settledRows.values()].filter((r) => r.jobState.section !== 'past')
  if (drift.length) console.error(`[jobs] settled rule drifted from deriveJobState: ${drift.map((r) => `${r.id}=${r.jobState.key}`).join(', ')}`)
  return { items: rows.flatMap((f) => openRows.get(f.id) ?? settledRows.get(f.id) ?? []), ...(next && { next }), counts }
}
