import { sql } from 'drizzle-orm'
import type { db } from '@kando/db'
import { FEEDBACK_ATTEMPT_KEEP_DAYS } from './feedback'

// Proposed keep periods (the owner decides; README). Stripe stops retrying an event after 3 days.
export const NOTIFICATION_KEEP_DAYS = 180
export const STRIPE_EVENT_KEEP_DAYS = 90
export const PUSH_TOKEN_KEEP_DAYS = 270
/** Kinds whose latest date a rule reads (timers.ts requests-ignored, watches.ts customers-waiting, notifications.ts profile-live): never pruned. */
const KEPT_KINDS = ['requests-ignored', 'customers-waiting', 'profile-live']

/**
 * The daily clean-up (the suspensions route): in-app notices seen or dismissed more than NOTIFICATION_KEEP_DAYS ago (an
 * unseen one stays), processed webhook events older than STRIPE_EVENT_KEEP_DAYS, device tokens not seen for
 * PUSH_TOKEN_KEEP_DAYS, and feedback rate-limit rows older than FEEDBACK_ATTEMPT_KEEP_DAYS. Owner connection. The numbers removed.
 */
export async function pruneOldRows(exec: typeof db, now: Date): Promise<{ notifications: number; stripeEvents: number; pushTokens: number; feedbackAttempts: number }> {
  const before = (days: number) => sql`${now.toISOString()}::timestamptz - make_interval(days => ${days})`
  const kept = sql.join(KEPT_KINDS.map((k) => sql`${k}`), sql`, `)
  const n = await exec.execute(sql`DELETE FROM notifications WHERE least(seen_at, dismissed_at) < ${before(NOTIFICATION_KEEP_DAYS)} AND kind NOT IN (${kept})`)
  const e = await exec.execute(sql`DELETE FROM stripe_events WHERE received_at < ${before(STRIPE_EVENT_KEEP_DAYS)}`)
  const p = await exec.execute(sql`DELETE FROM push_tokens WHERE last_seen_at < ${before(PUSH_TOKEN_KEEP_DAYS)}`)
  const f = await exec.execute(sql`DELETE FROM feedback_attempts WHERE created_at < ${before(FEEDBACK_ATTEMPT_KEEP_DAYS)}`)
  return { notifications: n.rowCount ?? 0, stripeEvents: e.rowCount ?? 0, pushTokens: p.rowCount ?? 0, feedbackAttempts: f.rowCount ?? 0 }
}
