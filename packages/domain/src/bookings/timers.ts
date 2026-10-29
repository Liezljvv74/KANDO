import { sql, type SQL } from 'drizzle-orm'
import type { Exec } from '../providers/eligibility'
import { IGNORED_LIMIT, IGNORED_WINDOW_DAYS } from './rules'

export type TimerReport = { requestsExpired: number; quotesExpired: number; proposalsLapsed: number; unpaidExpired: number; remindersSent: number; ignoredNotices: number }

/**
 * Every rule is ONE statement (UPDATE .. RETURNING feeding the notification INSERT), so a concurrent run cannot
 * process a row twice and a second run finds nothing. Deadlines are the stored columns, so a late run is still right.
 * Notification payloads carry ids only. userId narrows every rule to rows of that user (customer or provider owner).
 */
async function sweep(exec: Exec, now: Date, userId?: string): Promise<TimerReport> {
  const t = now.toISOString()
  const ownedBy = (col: string) => sql`${sql.identifier(col)} IN (SELECT id FROM providers WHERE owner_id = ${userId})`
  const scoped = (...cols: SQL[]): SQL => (userId ? sql` AND (${sql.join(cols, sql` OR `)})` : sql``)
  const count = async (q: SQL) => Number((await exec.execute<{ n: number }>(q)).rows[0]!.n)

  const requestsExpired = await count(sql`
    WITH e AS (UPDATE requests SET status = 'expired', updated_at = ${t}::timestamptz WHERE status = 'open' AND answer_by <= ${t}::timestamptz
        ${scoped(sql`customer_id = ${userId}`, ownedBy('provider_id'))} RETURNING id, customer_id),
    n AS (INSERT INTO notifications (user_id, kind, payload, created_at) SELECT customer_id, 'request-expired', jsonb_build_object('requestId', id), ${t}::timestamptz FROM e)
    SELECT count(*)::int AS n FROM e`)

  // The request stays 'quoted'; it simply has no live quote any more.
  const quotesExpired = await count(sql`
    WITH e AS (UPDATE quotes SET status = 'expired' WHERE status = 'sent' AND expires_at <= ${t}::timestamptz
        ${scoped(ownedBy('provider_id'), sql`request_id IN (SELECT id FROM requests WHERE customer_id = ${userId})`)} RETURNING id)
    SELECT count(*)::int AS n FROM e`)

  const bookingScope = scoped(sql`customer_id = ${userId}`, ownedBy('provider_id'))
  const proposalsLapsed = await count(sql`
    WITH e AS (UPDATE bookings SET status = 'expired', updated_at = ${t}::timestamptz WHERE status = 'proposed' AND answer_by <= ${t}::timestamptz ${bookingScope} RETURNING id, customer_id),
    n AS (INSERT INTO notifications (user_id, kind, payload, created_at) SELECT customer_id, 'booking-expired', jsonb_build_object('bookingId', id), ${t}::timestamptz FROM e)
    SELECT count(*)::int AS n FROM e`)

  const unpaidExpired = await count(sql`
    WITH e AS (UPDATE bookings SET status = 'expired', updated_at = ${t}::timestamptz WHERE status = 'awaiting-payment' AND pay_by <= ${t}::timestamptz ${bookingScope} RETURNING id, customer_id, provider_id),
    n AS (INSERT INTO notifications (user_id, kind, payload, created_at)
      SELECT u, 'booking-expired', jsonb_build_object('bookingId', id), ${t}::timestamptz
      FROM (SELECT id, customer_id AS u FROM e UNION ALL SELECT e.id, p.owner_id FROM e JOIN providers p ON p.id = e.provider_id) x)
    SELECT count(*)::int AS n FROM e`)

  // Reminders, each once (the reminded columns), never for a finished item. Acceptance time = updated_at: nothing
  // touches an awaiting-payment booking between accepting and expiring/withdrawing it.
  const quoteReminders = await count(sql`
    WITH r AS (UPDATE quotes SET reminder_sent_at = ${t}::timestamptz WHERE status = 'sent' AND reminder_sent_at IS NULL AND expires_at > ${t}::timestamptz
        AND expires_at - interval '1 day' <= ${t}::timestamptz ${scoped(ownedBy('provider_id'), sql`request_id IN (SELECT id FROM requests WHERE customer_id = ${userId})`)} RETURNING id, request_id),
    n AS (INSERT INTO notifications (user_id, kind, payload, created_at)
      SELECT q.customer_id, 'quote-expiring', jsonb_build_object('quoteId', r.id, 'requestId', r.request_id), ${t}::timestamptz FROM r JOIN requests q ON q.id = r.request_id)
    SELECT count(*)::int AS n FROM r`)
  const payReminder = (col: string, due: SQL) =>
    count(sql`
    WITH r AS (UPDATE bookings SET ${sql.identifier(col)} = ${t}::timestamptz WHERE status = 'awaiting-payment' AND ${sql.identifier(col)} IS NULL AND pay_by > ${t}::timestamptz AND ${due} ${bookingScope} RETURNING id, customer_id),
    n AS (INSERT INTO notifications (user_id, kind, payload, created_at) SELECT customer_id, 'payment-reminder', jsonb_build_object('bookingId', id), ${t}::timestamptz FROM r)
    SELECT count(*)::int AS n FROM r`)
  // halfway: only when 6h+ were given, and not when the last reminder is due as well (one message is enough)
  const half = await payReminder('reminded_half_at', sql`pay_by - updated_at >= interval '6 hours' AND updated_at + (pay_by - updated_at) / 2 <= ${t}::timestamptz AND pay_by - interval '3 hours' > ${t}::timestamptz`)
  const last = await payReminder('reminded_last_at', sql`pay_by - interval '3 hours' <= ${t}::timestamptz`)

  const ignoredNotices = await count(sql`
    WITH i AS (
      SELECT p.owner_id FROM providers p JOIN requests r ON r.provider_id = p.id
      WHERE r.status = 'expired' AND r.updated_at > ${t}::timestamptz - make_interval(days => ${IGNORED_WINDOW_DAYS}) ${userId ? sql`AND p.owner_id = ${userId}` : sql``}
      GROUP BY p.owner_id HAVING count(*) >= ${IGNORED_LIMIT}),
    n AS (INSERT INTO notifications (user_id, kind, payload, created_at) SELECT owner_id, 'requests-ignored', '{}'::jsonb, ${t}::timestamptz FROM i
      WHERE NOT EXISTS (SELECT 1 FROM notifications x WHERE x.user_id = i.owner_id AND x.kind = 'requests-ignored' AND x.created_at > ${t}::timestamptz - make_interval(days => ${IGNORED_WINDOW_DAYS})) RETURNING id)
    SELECT count(*)::int AS n FROM n`)

  return { requestsExpired, quotesExpired, proposalsLapsed, unpaidExpired, remindersSent: quoteReminders + half + last, ignoredNotices }
}

/** The hourly sweep (owner connection or a transaction). */
export const runDueTimers = (exec: Exec, now: Date): Promise<TimerReport> => sweep(exec, now)

/** The same rules for one user's own rows: a late sweep never shows them stale. Uses the owner connection (the app role may not write notifications). */
export const runDueTimersFor = (exec: Exec, userId: string, now = new Date()): Promise<TimerReport> => sweep(exec, now, userId)
