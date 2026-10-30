import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { availabilityWatches, db, notSuspendedSql, providers, type Tx } from '@kando/db'
import type { AfterCommit } from '../app-request'
import { notifyBookingEvent } from '../bookings/notify'
import { blockedWithProvider } from '../chat/blocks'
import type { Exec } from '../providers/eligibility'
import { fail } from '../providers/http'
import { isSuspendedNow } from '../providers/profile'
import { canTransact, CUSTOMERS_WAITING_NOTICE_HOURS } from './rules'

/** The cron runs once a day at a fixed hour but not to the minute: its gate is this much shorter than the strict one. */
export const CUSTOMERS_WAITING_CRON_TOLERANCE_HOURS = 4

/**
 * "Notify me when available": the customer's own watch (app connection; RLS keeps it private to them) on a published
 * provider that cannot be booked yet (bookable: 409 ALREADY_BOOKABLE; own profile 400; hidden, unknown or blocked 404).
 * Idempotent; a watch already answered is armed again. After the commit the provider is told at once, with the count only,
 * unless they had such a notice in the last CUSTOMERS_WAITING_NOTICE_HOURS (the daily cron then sends one summary).
 */
export async function watchProvider(tx: Tx, userId: string, slug: string, afterCommit: AfterCommit = () => {}): Promise<void> {
  const [p] = await tx.select().from(providers).where(eq(providers.slug, slug))
  if (!p || p.status !== 'published' || (await isSuspendedNow(tx, p.id)) || (await blockedWithProvider(tx, userId, p.id))) return fail(404, { error: 'Not found' })
  if (p.ownerId === userId) fail(400, { error: 'own-service' })
  if (canTransact(p)) fail(409, { error: 'ALREADY_BOOKABLE' })
  await tx
    .insert(availabilityWatches)
    .values({ customerId: userId, providerId: p.id })
    .onConflictDoUpdate({ target: [availabilityWatches.customerId, availabilityWatches.providerId], set: { notifiedAt: null, createdAt: sql`now()` }, setWhere: isNotNull(availabilityWatches.notifiedAt) })
  afterCommit(async () => {
    for (const e of await noticeCustomersWaiting(db, new Date(), CUSTOMERS_WAITING_NOTICE_HOURS, p.id)) await notifyBookingEvent('customers-waiting', e.userId, { count: String(e.count) }, { written: true })
  })
}

/** Removes the caller's watch, if any (also for a provider no longer visible); always succeeds. */
export async function unwatchProvider(tx: Tx, userId: string, slug: string): Promise<void> {
  const id = (await db.select({ id: providers.id }).from(providers).where(eq(providers.slug, slug)))[0]?.id // owner connection: a hidden provider too; nothing is returned
  if (id) await tx.delete(availabilityWatches).where(and(eq(availabilityWatches.customerId, userId), eq(availabilityWatches.providerId, id)))
}

/**
 * Writes the in-app "customers want to book you" rows (payload: the count only, never who) for every published,
 * not suspended provider without payout set-up that has a waiting watch newer than its last such notice, the last one
 * at least `hours` ago; `providerId` narrows it to one provider. One statement under a constant-key lock (owner
 * connection, held to the commit): two taps or runs at the same instant take turns, and the second finds the first's row.
 * Returns the rows written, for their emails (sent by the caller after this commit); `queued` (the timers) leaves the rows
 * unsent for the outbox (bookings/outbox.ts) instead.
 */
export async function noticeCustomersWaiting(exec: Exec, now: Date, hours: number, providerId?: string, queued = false): Promise<{ userId: string; count: number }[]> {
  const t = now.toISOString()
  return (exec as typeof db).transaction(async (o) => {
    await o.execute(sql`SELECT pg_advisory_xact_lock(hashtext('customers_waiting'))`)
    const { rows } = await o.execute<{ user_id: string; count: number }>(sql`
      WITH last AS (SELECT user_id, max(created_at) AS at FROM notifications WHERE kind = 'customers-waiting' GROUP BY user_id),
      d AS (SELECT p.owner_id, (SELECT count(*) FROM availability_watches a WHERE a.provider_id = p.id AND a.notified_at IS NULL)::int AS c
        FROM providers p LEFT JOIN last l ON l.user_id = p.owner_id
        WHERE p.payouts_ready_at IS NULL AND p.status = 'published' AND ${notSuspendedSql('p')} ${providerId ? sql`AND p.id = ${providerId}` : sql``}
          AND coalesce(l.at, '-infinity') <= ${t}::timestamptz - make_interval(hours => ${hours})
          AND EXISTS (SELECT 1 FROM availability_watches w WHERE w.provider_id = p.id AND w.notified_at IS NULL AND w.created_at > coalesce(l.at, '-infinity')))
      INSERT INTO notifications (user_id, kind, payload, created_at, mailed_at)
      SELECT owner_id, 'customers-waiting', jsonb_build_object('count', c), ${t}::timestamptz, ${queued ? null : t}::timestamptz FROM d WHERE c > 0
      RETURNING user_id, (payload->>'count')::int AS count`)
    return rows.map((r) => ({ userId: r.user_id, count: Number(r.count) }))
  })
}
