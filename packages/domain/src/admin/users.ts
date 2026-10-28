import { and, count, desc, eq, gt, ilike, inArray, lte, or, sql } from 'drizzle-orm'
import { db, photos, providers, users, type Tx } from '@kando/db'
import type { AdminListQuery, AdminUser } from '@kando/contract'
import { isLang } from '@kando/i18n'
import { inBatches } from '../batches'
import { notifySuspension } from '../notifications'
import type { AfterCommit } from '../app-request'
import { fail } from '../providers/http'
import { photoUrl } from '../storage'
import { addressOf, type StaffUser } from '../users'
import { filterOf, like, notFound, ok, orderOf, pageOf, textOf } from './common'

/** "First Last" for searching in SQL. */
export const fullName = sql`concat_ws(' ', ${users.firstName}, ${users.lastName})`

export const toAdminUser = (r: typeof users.$inferSelect, picture: { id: string; key: string } | null = null): AdminUser => ({
  id: r.id,
  firstName: r.firstName,
  lastName: r.lastName,
  address: addressOf(r),
  photoUrl: picture ? photoUrl(picture.key) : null,
  photoId: picture?.id ?? null,
  email: r.email,
  language: isLang(r.language) ? r.language : null,
  staffRole: r.staffRole === 'admin' || r.staffRole === 'reviewer' ? r.staffRole : null,
  isProvider: r.isProvider,
  suspendedUntil: r.suspendedUntil?.toISOString() ?? null,
  suspendedReason: r.suspendedReason,
  createdAt: r.createdAt.toISOString(),
})

/** The users with their pictures (the person's profile photo), one query for the page. */
export async function withPictures(tx: Tx, rows: (typeof users.$inferSelect)[]): Promise<AdminUser[]> {
  const pics = rows.length
    ? await tx.select({ ownerId: photos.ownerId, id: photos.id, key: photos.key }).from(photos).where(and(eq(photos.kind, 'profile'), inArray(photos.ownerId, rows.map((r) => r.id))))
    : []
  return rows.map((r) => toAdminUser(r, pics.find((p) => p.ownerId === r.id) ?? null))
}

/** Search by email or name; filter `suspended: true` lists active suspensions only (a suspension ends by its date). */
export async function listUsers(tx: Tx, q: AdminListQuery) {
  const f = filterOf(q)
  const text = textOf(f.q)
  const where = and(
    text ? or(ilike(users.email, like(text)), ilike(fullName, like(text))) : undefined,
    f.suspended === true ? gt(users.suspendedUntil, sql`now()`) : undefined,
  )
  const total = (await tx.select({ n: count() }).from(users).where(where))[0]!.n
  const rows = await tx
    .select()
    .from(users)
    .where(where)
    .orderBy(...orderOf(q.sort, { createdAt: users.createdAt, email: users.email }, [desc(users.createdAt), desc(users.id)]))
    .limit(pageOf(q).limit)
    .offset(pageOf(q).offset)
  return ok(await withPictures(tx, rows), total)
}

export async function getUser(tx: Tx, id: string) {
  const row = (await tx.select().from(users).where(eq(users.id, id)))[0]
  if (!row) return notFound()
  return ok((await withPictures(tx, [row]))[0])
}

/**
 * Suspends the user until `until`, or lifts it (null). The user's provider is hidden or shown with it
 * (search and the public page both check providers.suspended_until, so the hiding ends with the date).
 */
export async function suspendUser(tx: Tx, staff: StaffUser, id: string, input: { until: string | null; reason: string }, afterCommit: AfterCommit) {
  const until = input.until ? new Date(input.until) : null
  if (until && until <= new Date()) return fail(400, { error: 'The end must be in the future' })
  if (until && !input.reason) return fail(400, { error: 'A reason is required' })
  if (until && id === staff.id) return fail(400, { error: 'You cannot suspend yourself' })
  const was = (await tx.select({ s: users.suspendedUntil }).from(users).where(eq(users.id, id)))[0]?.s
  const [row] = await tx
    .update(users)
    .set({ suspendedUntil: until, suspendedReason: until ? input.reason : null, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning()
  if (!row) return notFound()
  const hidden = await tx.update(providers).set({ suspendedUntil: until, updatedAt: sql`now()` }).where(eq(providers.ownerId, id)).returning({ status: providers.status })
  // the email speaks of the live profile: only a published one is told, and of a lift only when the column was still set
  // (an ended date the daily check has not cleared yet counts: clearing it here removes the check's only chance to tell them)
  if (hidden.some((h) => h.status === 'published') && (until || was)) afterCommit(() => notifySuspension(id, { until, reason: input.reason }))
  return ok((await withPictures(tx, [row]))[0])
}

/** The daily check: ends every suspension whose date has passed (as a lift does), then emails "published again". Returns the user ids. */
export async function endExpiredSuspensions(exec: typeof db): Promise<string[]> {
  const ended = await exec.transaction(async (tx) => {
    const rows = await tx
      .update(users)
      .set({ suspendedUntil: null, suspendedReason: null, updatedAt: new Date() })
      .where(lte(users.suspendedUntil, sql`now()`))
      .returning({ id: users.id })
    const ids = rows.map((r) => r.id)
    const hidden = ids.length ? await tx.update(providers).set({ suspendedUntil: null, updatedAt: sql`now()` }).where(inArray(providers.ownerId, ids)).returning({ owner: providers.ownerId, status: providers.status }) : []
    return { ids, withProfile: hidden.filter((h) => h.status === 'published').map((h) => h.owner) }
  })
  await inBatches(ended.withProfile, 5, (id) => notifySuspension(id, { until: null, reason: '' })) // the email speaks of the live profile
  return ended.ids
}
