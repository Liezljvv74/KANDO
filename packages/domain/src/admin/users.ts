import { and, count, desc, eq, ilike, isNotNull, or, sql } from 'drizzle-orm'
import { providers, users, type Tx } from '@kando/db'
import type { AdminListQuery, AdminUser } from '@kando/contract'
import { fail } from '../providers/http'
import type { StaffUser } from '../users'
import { filterOf, like, notFound, ok, orderOf, pageOf, textOf } from './common'

export const toAdminUser = (r: typeof users.$inferSelect): AdminUser => ({
  id: r.id,
  name: r.name,
  email: r.email,
  language: r.language === 'de' || r.language === 'en' ? r.language : null,
  staffRole: r.staffRole === 'admin' || r.staffRole === 'reviewer' ? r.staffRole : null,
  isProvider: r.isProvider,
  suspendedUntil: r.suspendedUntil?.toISOString() ?? null,
  suspendedReason: r.suspendedReason,
  createdAt: r.createdAt.toISOString(),
})

/** Search by email or name; filter `suspended: true` lists users with a suspension (running or past). */
export async function listUsers(tx: Tx, q: AdminListQuery) {
  const f = filterOf(q)
  const text = textOf(f.q)
  const where = and(
    text ? or(ilike(users.email, like(text)), ilike(users.name, like(text))) : undefined,
    f.suspended === true ? isNotNull(users.suspendedUntil) : undefined,
  )
  const total = (await tx.select({ n: count() }).from(users).where(where))[0]!.n
  const rows = await tx
    .select()
    .from(users)
    .where(where)
    .orderBy(...orderOf(q.sort, { createdAt: users.createdAt, email: users.email }, [desc(users.createdAt), desc(users.id)]))
    .limit(pageOf(q).limit)
    .offset(pageOf(q).offset)
  return ok(rows.map(toAdminUser), total)
}

export async function getUser(tx: Tx, id: string) {
  const row = (await tx.select().from(users).where(eq(users.id, id)))[0]
  return row ? ok(toAdminUser(row)) : notFound()
}

/**
 * Suspends the user until `until`, or lifts it (null). The user's provider is hidden or shown with it
 * (search and the public page both check providers.suspended).
 */
export async function suspendUser(tx: Tx, staff: StaffUser, id: string, input: { until: string | null; reason: string }) {
  const until = input.until ? new Date(input.until) : null
  if (until && until <= new Date()) return fail(400, { error: 'The end must be in the future' })
  if (until && !input.reason) return fail(400, { error: 'A reason is required' })
  if (until && id === staff.id) return fail(400, { error: 'You cannot suspend yourself' })
  const [row] = await tx
    .update(users)
    .set({ suspendedUntil: until, suspendedReason: until ? input.reason : null, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning()
  if (!row) return notFound()
  await tx.update(providers).set({ suspended: !!until, updatedAt: sql`now()` }).where(eq(providers.ownerId, id))
  return ok(toAdminUser(row))
}
