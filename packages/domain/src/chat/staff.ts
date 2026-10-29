import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { contactAttempts, db, messages, staffAccessLog, staffFlags, threads, users } from '@kando/db'
import type { AdminListQuery } from '@kando/contract'
import { filterOf, isUuid, like, notFound, ok, orderOf, pageOf, textOf } from '../admin/common'
import type { Exec } from '../providers/eligibility'
import { fail } from '../providers/http'
import { chatPhotoLink, TS } from './messages'

/**
 * Staff read a thread only with a reason: one of its messages has a `message-reported` flag (open or resolved); the
 * answer is that flag's id (the earliest), or null. Plan 2d widens this to disputed bookings: this is the single place to do it.
 */
export async function threadReadReason(exec: Exec, threadId: string): Promise<string | null> {
  if (!isUuid(threadId)) return null
  const r = await exec.execute(sql`SELECT f.id FROM staff_flags f JOIN messages m ON m.id::text = f.ref_id
    WHERE f.kind = 'message-reported' AND m.thread_id = ${threadId}::uuid ORDER BY f.created_at, f.id LIMIT 1`)
  return (r.rows[0]?.id as string | undefined) ?? null
}

export async function staffMayReadThread(exec: Exec, threadId: string): Promise<boolean> {
  return (await threadReadReason(exec, threadId)) !== null
}

/**
 * One row per staff attempt on a thread, allowed or denied (flag_id is the reason; no message text). Written on the owner
 * connection, so a denied attempt survives the 404 that rolls the request back. A failed insert fails the read (500): no unlogged reads.
 */
export async function logStaffThreadAccess(staffId: string, threadId: string, flagId: string | null): Promise<void> {
  if (!isUuid(threadId)) return
  await db.insert(staffAccessLog).values({ staffId, threadId, flagId, outcome: flagId ? 'allowed' : 'denied' })
}

export type StaffMessage = {
  id: string
  senderId: string
  senderName: string
  senderRole: 'customer' | 'provider'
  kind: string
  body: string | null
  photoUrl: string | null
  card: unknown
  createdAt: string
  reports: { flagId: string; reason: string | null; reporterId: string | null; reporterName: string; reporterEmail: string | null; resolved: boolean }[]
}

/** The whole thread, oldest first, for staff; 404 (not 403) without a reason, so no one learns whether a thread exists. Staff see who reported. */
export async function staffThread(exec: Exec, threadId: string): Promise<StaffMessage[]> {
  if (!(await staffMayReadThread(exec, threadId))) return fail(404, { error: 'Not found' })
  const t = (await exec.select().from(threads).where(eq(threads.id, threadId)))[0]!
  const rows = await exec
    .select({ m: messages, ts: TS, first: users.firstName, last: users.lastName, email: users.email })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.senderId))
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.createdAt), asc(messages.id))
  const flags = await exec
    .select({ id: staffFlags.id, refId: staffFlags.refId, userId: staffFlags.userId, note: staffFlags.note, resolvedAt: staffFlags.resolvedAt })
    .from(staffFlags)
    .where(and(eq(staffFlags.kind, 'message-reported'), sql`${staffFlags.refId} IN (SELECT id::text FROM messages WHERE thread_id = ${threadId}::uuid)`))
    .orderBy(asc(staffFlags.createdAt))
  const reporters = new Map((flags.length ? await exec.select({ id: users.id, first: users.firstName, last: users.lastName, email: users.email }).from(users).where(inArray(users.id, flags.flatMap((f) => (f.userId ? [f.userId] : [])))) : []).map((u) => [u.id, u]))
  const nameOf = (first: string | null, last: string | null, email: string) => [first, last].filter(Boolean).join(' ') || email
  return Promise.all(
    rows.map(async ({ m, ts, first, last, email }) => ({
      id: m.id,
      senderId: m.senderId,
      senderName: nameOf(first, last, email),
      senderRole: m.senderId === t.customerId ? ('customer' as const) : ('provider' as const),
      kind: m.kind,
      body: m.body,
      photoUrl: await chatPhotoLink(m.threadId, m.photoKey),
      card: m.card,
      createdAt: ts,
      reports: flags.filter((f) => f.refId === m.id).map((f) => {
        const u = f.userId ? reporters.get(f.userId) : undefined
        return { flagId: f.id, reason: f.note, reporterId: f.userId, reporterName: u ? nameOf(u.first, u.last, u.email) : '', reporterEmail: u?.email ?? null, resolved: f.resolvedAt !== null }
      }),
    })),
  )
}

/** Marks a flag resolved by this Administrator. Idempotent: a second call keeps the first resolver. 404 for an unknown id. */
export async function resolveFlag(exec: Exec, staffId: string, id: string): Promise<Response> {
  if (!isUuid(id)) return notFound()
  const done = await exec.update(staffFlags).set({ resolvedAt: new Date(), resolvedBy: staffId }).where(and(eq(staffFlags.id, id), sql`${staffFlags.resolvedAt} IS NULL`)).returning({ id: staffFlags.id })
  if (!done.length && !(await exec.select({ id: staffFlags.id }).from(staffFlags).where(eq(staffFlags.id, id))).length) return notFound()
  return new Response(null, { status: 204 })
}

const threadOfFlag = sql<string | null>`(SELECT m.thread_id::text FROM messages m WHERE ${staffFlags.kind} = 'message-reported' AND m.id::text = ${staffFlags.refId})`

const flagCols = {
  id: staffFlags.id,
  kind: staffFlags.kind,
  userId: staffFlags.userId,
  // user_id is the REPORTER of a message-reported flag but the person concerned of a contact-attempts flag
  reporterEmail: sql<string | null>`CASE WHEN ${staffFlags.kind} = 'message-reported' THEN ${users.email} END`,
  concernedEmail: sql<string | null>`CASE WHEN ${staffFlags.kind} = 'message-reported'
    THEN (SELECT u.email FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id::text = ${staffFlags.refId}) ELSE ${users.email} END`,
  note: staffFlags.note,
  createdAt: staffFlags.createdAt,
  resolvedAt: staffFlags.resolvedAt,
  resolvedBy: staffFlags.resolvedBy,
  threadId: threadOfFlag,
}
const flagDto = <T extends { createdAt: Date; resolvedAt: Date | null }>(r: T) => ({ ...r, createdAt: r.createdAt.toISOString(), resolvedAt: r.resolvedAt?.toISOString() ?? null })

/** Open flags first (oldest first), then resolved ones, newest first. Filters: `kind`, `resolved` (boolean), `q` (user email or note). */
export async function listFlags(exec: Exec, q: AdminListQuery) {
  const f = filterOf(q)
  const text = textOf(f.q)
  const where = and(
    textOf(f.kind) ? eq(staffFlags.kind, textOf(f.kind)!) : undefined,
    typeof f.resolved === 'boolean' ? sql`(${staffFlags.resolvedAt} IS NOT NULL) = ${f.resolved}` : undefined,
    text ? or(ilike(users.email, like(text)), ilike(staffFlags.note, like(text))) : undefined,
  )
  const total = (await exec.select({ n: count() }).from(staffFlags).leftJoin(users, eq(users.id, staffFlags.userId)).where(where))[0]!.n
  const rows = await exec
    .select(flagCols)
    .from(staffFlags)
    .leftJoin(users, eq(users.id, staffFlags.userId))
    .where(where)
    .orderBy(...orderOf(q.sort, { createdAt: staffFlags.createdAt, kind: staffFlags.kind }, [sql`(${staffFlags.resolvedAt} IS NOT NULL)`, desc(staffFlags.createdAt), desc(staffFlags.id)]))
    .limit(pageOf(q).limit)
    .offset(pageOf(q).offset)
  return ok(rows.map(flagDto), total)
}

/** One flag. A contact-attempts flag carries the user's latest blocked texts so staff can judge; they are not attached to any thread. */
export async function getFlag(exec: Exec, id: string) {
  const row = isUuid(id) ? (await exec.select(flagCols).from(staffFlags).leftJoin(users, eq(users.id, staffFlags.userId)).where(eq(staffFlags.id, id)))[0] : undefined
  if (!row) return notFound()
  const attempts =
    row.kind === 'contact-attempts' && row.userId
      ? (await exec.select({ hit: contactAttempts.hit, text: contactAttempts.text, createdAt: contactAttempts.createdAt }).from(contactAttempts).where(eq(contactAttempts.userId, row.userId)).orderBy(desc(contactAttempts.createdAt)).limit(20)).map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }))
      : []
  return ok({ ...flagDto(row), attempts })
}
