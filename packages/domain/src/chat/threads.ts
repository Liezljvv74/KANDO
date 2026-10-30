import { desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import { bookings, db, providers, quotes, requests, threads, users, type Tx } from '@kando/db'
import { LIST_PAGE, type Page, type Thread } from '@kando/contract'
import { isUuid } from '../admin/common'
import type { Exec } from '../providers/eligibility'
import { fail } from '../providers/http'
import { publicNameFor } from '../providers/public-name'
import { olderThan, pageOf, stampOf } from '../paging'

const notFound = () => fail(404, { error: 'Not found' })

/**
 * The thread of a request, created on first use. Two first uses at once give one thread (unique request_id, ON CONFLICT).
 * 404 for a non-party. An additional task's request talks in the thread of the booking it adds to.
 */
export async function threadForRequest(tx: Exec, requestId: string): Promise<string> {
  const r = isUuid(requestId) ? (await tx.select().from(requests).where(eq(requests.id, requestId)))[0] : undefined
  if (!r) return notFound()
  if (r.parentBookingId) return threadForBooking(tx, r.parentBookingId)
  await tx.insert(threads).values({ requestId: r.id, customerId: r.customerId, providerId: r.providerId }).onConflictDoNothing()
  return (await tx.select({ id: threads.id }).from(threads).where(eq(threads.requestId, r.id)))[0]!.id
}

/**
 * The thread of a booking: a booking from a quote shares its request's thread, a direct booking has its own (created on
 * first use); an additional task shares its parent's (through its request). `tx` is the caller's request transaction
 * (RLS: 404 for a non-party), or the owner connection after the domain checked the caller.
 */
export async function threadForBooking(tx: Exec, bookingId: string): Promise<string> {
  const b = isUuid(bookingId) ? (await tx.select().from(bookings).where(eq(bookings.id, bookingId)))[0] : undefined
  if (!b) return notFound()
  if (b.quoteId) {
    const q = (await tx.select({ requestId: quotes.requestId }).from(quotes).where(eq(quotes.id, b.quoteId)))[0]
    if (q) return threadForRequest(tx, q.requestId)
  }
  await tx.insert(threads).values({ bookingId: b.id, customerId: b.customerId, providerId: b.providerId }).onConflictDoNothing()
  return (await tx.select({ id: threads.id }).from(threads).where(eq(threads.bookingId, b.id)))[0]!.id
}

/**
 * The thread a booking talks in, read-only (none is created): its own, else its request's, else its parent booking's.
 * `exec` is the caller's request transaction (RLS) or the owner connection.
 */
export async function threadIdOf(exec: Exec, b: { id: string; requestId: string | null; parentBookingId: string | null }): Promise<string | null> {
  const own = (await exec.select({ id: threads.id }).from(threads).where(or(eq(threads.bookingId, b.id), b.requestId ? eq(threads.requestId, b.requestId) : undefined)).limit(1))[0]
  if (own || !b.parentBookingId) return own?.id ?? null
  const parent = (await exec.select({ id: bookings.id, requestId: bookings.requestId, parentBookingId: bookings.parentBookingId }).from(bookings).where(eq(bookings.id, b.parentBookingId)))[0]
  return parent ? threadIdOf(exec, parent) : null
}

/** Who may read a thread: its customer or the provider's owner. Anyone else (and a bad id) gets 404. */
export async function ownThread(tx: Tx, threadId: string) {
  const t = isUuid(threadId) ? (await tx.select().from(threads).where(eq(threads.id, threadId)))[0] : undefined // RLS hides it from a third person
  return t ?? notFound()
}

/** The other side's public name; the names are read on the owner connection, for threads the caller already is a party of. */
async function otherSides(userId: string, rows: (typeof threads.$inferSelect)[]): Promise<Map<string, string>> {
  if (!rows.length) return new Map()
  const found = await db
    .select({ id: threads.id, customerId: threads.customerId, first: users.firstName, last: users.lastName, p: providers })
    .from(threads)
    .innerJoin(users, eq(users.id, threads.customerId))
    .innerJoin(providers, eq(providers.id, threads.providerId))
    .where(inArray(threads.id, rows.map((r) => r.id)))
  const owners = await db.select({ id: users.id, first: users.firstName, last: users.lastName }).from(users).where(inArray(users.id, found.map((f) => f.p.ownerId)))
  const byId = new Map(owners.map((o) => [o.id, o]))
  return new Map(
    found.map((f) => {
      const owner = byId.get(f.p.ownerId)
      const name = f.customerId === userId ? f.p.publicName || publicNameFor(owner?.first ?? null, owner?.last ?? null, f.p.businessName, f.p.type) : publicNameFor(f.first, f.last, null, null)
      return [f.id, name]
    }),
  )
}

const lastMessage = sql<Date | null>`(SELECT max(m.created_at) FROM messages m WHERE m.thread_id = ${threads.id})`
const activity = sql`coalesce(${lastMessage}, ${threads.createdAt})`

/** The caller's threads (RLS shows a party only their own) matching `where`, most recently active first. */
async function threadRows(tx: Tx, userId: string, where: SQL | undefined, limit: number) {
  const rows = await tx
    .select({ t: threads, last: lastMessage, blocked: sql<boolean>`is_blocked(${threads.customerId}, ${threads.providerId})`, ts: stampOf(activity), id: threads.id })
    .from(threads)
    .where(where)
    .orderBy(desc(activity), desc(threads.id))
    .limit(limit)
  const others = await otherSides(userId, rows.map((r) => r.t))
  const toThread = ({ t, last, blocked }: (typeof rows)[number]): Thread => ({
    id: t.id,
    requestId: t.requestId,
    bookingId: t.bookingId,
    otherName: others.get(t.id) ?? '',
    lastMessageAt: last ? new Date(last).toISOString() : null,
    blocked,
  })
  return rows.map((r) => ({ ...r, thread: toThread(r) }))
}

/** The caller's threads, a page most recently active first (the cursor is the last activity time and the id). */
export async function listThreads(tx: Tx, userId: string, cursor?: string): Promise<Page<Thread>> {
  const { rows, next } = pageOf(await threadRows(tx, userId, olderThan(activity, threads.id, cursor), LIST_PAGE + 1))
  return { docs: rows.map((r) => r.thread), next }
}

/** One thread, for one of its parties; 404 for anyone else. */
export async function getThread(tx: Tx, userId: string, id: string): Promise<Thread> {
  const t = await ownThread(tx, id)
  return (await threadRows(tx, userId, eq(threads.id, t.id), 1))[0]?.thread ?? notFound()
}
