import { sql } from 'drizzle-orm'
import type { db } from '@kando/db'
import { notifyBookingEvent, type BookingKind } from './notify'

/** An unsent notice older than this is not emailed any more (a two-day-old "payment due" is worse than none). */
export const OUTBOX_MAX_AGE_HOURS = 48

/**
 * Sends the email and push of the in-app rows still waiting (`mailed_at` NULL: the timers write them so), oldest first, one
 * at a time: each row is claimed (marked sent) in its own statement before its send, so a run cut off loses at most the
 * one email in flight, and two runs never send the same row (SKIP LOCKED). `ids` narrows it to those rows (the lazy
 * per-user sweep); `timeUp` stops it before the next row (the rest go in the next run). The number sent.
 * ponytail: one scan of the unsent rows per claim, no index (the table is pruned, retention.ts); add a partial index on
 * (created_at) WHERE mailed_at IS NULL if a run ever sends thousands.
 */
export async function drainOutbox(exec: typeof db, now: Date, opts: { ids?: string[]; timeUp?: () => boolean } = {}): Promise<number> {
  const { ids, timeUp = () => false } = opts
  if (ids && !ids.length) return 0
  let sent = 0
  while (!timeUp()) {
    const [row] = (
      await exec.execute<{ user_id: string; kind: BookingKind; payload: Record<string, unknown> }>(sql`
      UPDATE notifications SET mailed_at = ${now.toISOString()}::timestamptz WHERE id = (
        SELECT id FROM notifications WHERE mailed_at IS NULL AND created_at > ${now.toISOString()}::timestamptz - make_interval(hours => ${OUTBOX_MAX_AGE_HOURS})
          ${ids ? sql`AND id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})` : sql``}
        ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING user_id, kind, payload`)
    ).rows
    if (!row) break
    // the email takes strings (customers-waiting stores its count as a number)
    await notifyBookingEvent(row.kind, row.user_id, Object.fromEntries(Object.entries(row.payload).map(([k, v]) => [k, String(v)])), { written: true })
    sent++
  }
  return sent
}
