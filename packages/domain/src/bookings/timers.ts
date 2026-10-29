import { sql, type SQL } from 'drizzle-orm'
import type { db } from '@kando/db'
import type { Exec } from '../providers/eligibility'
import { notifyBookingEvent, type BookingKind } from './notify'
import { PAY_GRACE_MINUTES } from '../payments/rules'
import { IGNORED_LIMIT, IGNORED_WINDOW_DAYS } from './rules'

export type TimerReport = { requestsExpired: number; quotesExpired: number; proposalsLapsed: number; unpaidExpired: number; remindersSent: number; ignoredNotices: number }

/**
 * Every rule is ONE statement (UPDATE .. RETURNING feeding the notification INSERT), so a concurrent run cannot
 * process a row twice and a second run finds nothing. Deadlines are the stored columns, so a late run is still right.
 * Notification payloads carry ids only. userId narrows every rule to rows of that user (customer or provider owner).
 */
type TimerEvent = { userId: string; kind: BookingKind; payload: Record<string, string> }
/** Counts the rows of CTE `from` and returns the notification rows CTE `n` inserted (ids only), so their emails can follow. */
const result = (from: string) => sql`SELECT (SELECT count(*) FROM ${sql.identifier(from)})::int AS n, (SELECT coalesce(jsonb_agg(jsonb_build_object('userId', user_id, 'kind', kind, 'payload', payload)), '[]'::jsonb) FROM n) AS ev`

async function sweep(exec: Exec, now: Date, userId?: string, expiryOnly = false): Promise<TimerReport & { events: TimerEvent[] }> {
  const events: TimerEvent[] = []
  const t = now.toISOString()
  const ownedBy = (col: string) => sql`${sql.identifier(col)} IN (SELECT id FROM providers WHERE owner_id = ${userId})`
  const scoped = (...cols: SQL[]): SQL => (userId ? sql` AND (${sql.join(cols, sql` OR `)})` : sql``)
  const countOn = async (e: Exec, q: SQL) => {
    const row = (await e.execute<{ n: number; ev?: TimerEvent[] }>(q)).rows[0]!
    events.push(...(row.ev ?? []))
    return Number(row.n)
  }
  const count = (q: SQL) => countOn(exec, q)

  const requestsExpired = await count(sql`
    WITH e AS (UPDATE requests SET status = 'expired', updated_at = ${t}::timestamptz WHERE status = 'open' AND answer_by <= ${t}::timestamptz
        ${scoped(sql`customer_id = ${userId}`, ownedBy('provider_id'))} RETURNING id, customer_id),
    n AS (INSERT INTO notifications (user_id, kind, payload, created_at) SELECT customer_id, 'request-expired', jsonb_build_object('requestId', id), ${t}::timestamptz FROM e RETURNING user_id, kind, payload)
    ${result('e')}`)

  // The request stays 'quoted'; it simply has no live quote any more.
  const quotesExpired = await count(sql`
    WITH e AS (UPDATE quotes SET status = 'expired' WHERE status = 'sent' AND expires_at <= ${t}::timestamptz
        ${scoped(ownedBy('provider_id'), sql`request_id IN (SELECT id FROM requests WHERE customer_id = ${userId})`)} RETURNING id)
    SELECT count(*)::int AS n FROM e`)

  const bookingScope = scoped(sql`customer_id = ${userId}`, ownedBy('provider_id'))
  const proposalsLapsed = await count(sql`
    WITH e AS (UPDATE bookings SET status = 'expired', updated_at = ${t}::timestamptz WHERE status = 'proposed' AND answer_by <= ${t}::timestamptz ${bookingScope} RETURNING id, customer_id),
    n AS (INSERT INTO notifications (user_id, kind, payload, created_at) SELECT customer_id, 'booking-expired', jsonb_build_object('bookingId', id), ${t}::timestamptz FROM e RETURNING user_id, kind, payload)
    ${result('e')}`)

  // PAY_GRACE_MINUTES after pay_by: a payment made at the deadline may still be on its way (the webhook confirms it if the
  // time is still free). The slot itself stops being held at pay_by (slotIsHeld, busy_times) and no pay link is given after it.
  const unpaidExpired = await count(sql`
    WITH e AS (UPDATE bookings SET status = 'expired', updated_at = ${t}::timestamptz WHERE status = 'awaiting-payment' AND pay_by + make_interval(mins => ${PAY_GRACE_MINUTES}) <= ${t}::timestamptz ${bookingScope} RETURNING id, customer_id, provider_id),
    n AS (INSERT INTO notifications (user_id, kind, payload, created_at)
      SELECT u, 'booking-expired', jsonb_build_object('bookingId', id), ${t}::timestamptz
      FROM (SELECT id, customer_id AS u FROM e UNION ALL SELECT e.id, p.owner_id FROM e JOIN providers p ON p.id = e.provider_id) x RETURNING user_id, kind, payload)
    ${result('e')}`)

  if (expiryOnly) return { requestsExpired, quotesExpired, proposalsLapsed, unpaidExpired, remindersSent: 0, ignoredNotices: 0, events }

  // Reminders, each once (the reminded columns), never for a finished item. They count from accepted_at (set when the
  // booking became awaiting-payment), so a later write to the row does not move them.
  const quoteReminders = await count(sql`
    WITH r AS (UPDATE quotes SET reminder_sent_at = ${t}::timestamptz WHERE status = 'sent' AND reminder_sent_at IS NULL AND expires_at > ${t}::timestamptz
        AND expires_at - interval '1 day' <= ${t}::timestamptz ${scoped(ownedBy('provider_id'), sql`request_id IN (SELECT id FROM requests WHERE customer_id = ${userId})`)} RETURNING id, request_id),
    n AS (INSERT INTO notifications (user_id, kind, payload, created_at)
      SELECT q.customer_id, 'quote-expiring', jsonb_build_object('quoteId', r.id, 'requestId', r.request_id), ${t}::timestamptz FROM r JOIN requests q ON q.id = r.request_id RETURNING user_id, kind, payload)
    ${result('r')}`)
  const payReminder = (col: string, due: SQL) =>
    count(sql`
    WITH r AS (UPDATE bookings SET ${sql.identifier(col)} = ${t}::timestamptz WHERE status = 'awaiting-payment' AND ${sql.identifier(col)} IS NULL AND pay_by > ${t}::timestamptz AND ${due} ${bookingScope} RETURNING id, customer_id),
    n AS (INSERT INTO notifications (user_id, kind, payload, created_at) SELECT customer_id, 'payment-reminder', jsonb_build_object('bookingId', id), ${t}::timestamptz FROM r RETURNING user_id, kind, payload)
    ${result('r')}`)
  // halfway: only when 6h+ were given, and not when the last reminder is due as well (one message is enough)
  const half = await payReminder('reminded_half_at', sql`pay_by - accepted_at >= interval '6 hours' AND accepted_at + (pay_by - accepted_at) / 2 <= ${t}::timestamptz AND pay_by - interval '3 hours' > ${t}::timestamptz`)
  const last = await payReminder('reminded_last_at', sql`pay_by - interval '3 hours' <= ${t}::timestamptz`)

  const ignoredNotices = await (exec as typeof db).transaction(async (tx) => {
    // a constant-key lock, held until commit, serialises overlapping runs: the second one sees the first one's notice
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('requests_ignored'))`)
    return countOn(tx, sql`
    WITH i AS (
      SELECT p.owner_id FROM providers p JOIN requests r ON r.provider_id = p.id
      WHERE r.status = 'expired' AND r.updated_at > ${t}::timestamptz - make_interval(days => ${IGNORED_WINDOW_DAYS})
      GROUP BY p.owner_id HAVING count(*) >= ${IGNORED_LIMIT}),
    n AS (INSERT INTO notifications (user_id, kind, payload, created_at) SELECT owner_id, 'requests-ignored', '{}'::jsonb, ${t}::timestamptz FROM i
      WHERE NOT EXISTS (SELECT 1 FROM notifications x WHERE x.user_id = i.owner_id AND x.kind = 'requests-ignored' AND x.created_at > ${t}::timestamptz - make_interval(days => ${IGNORED_WINDOW_DAYS})) RETURNING user_id, kind, payload)
    ${result('n')}`)
  })

  return { requestsExpired, quotesExpired, proposalsLapsed, unpaidExpired, remindersSent: quoteReminders + half + last, ignoredNotices, events }
}

/**
 * Sends the emails of the in-app rows a sweep just wrote (the SQL writes the row, notifyBookingEvent sends only the email
 * for these kinds, so there is one row and one email per event). Never throws; the sweep is committed before this runs
 * (unless the caller passed an open transaction).
 */
async function sendEmails({ events, ...report }: TimerReport & { events: TimerEvent[] }): Promise<TimerReport> {
  for (const e of events) await notifyBookingEvent(e.kind, e.userId, e.payload)
  return report
}

/** The scheduled sweep (owner connection or a transaction). */
export const runDueTimers = async (exec: Exec, now: Date): Promise<TimerReport> => sendEmails(await sweep(exec, now))

/** The four expiry rules for one user's own rows (no reminders, no ignored notice: those stay in the cron run): a late sweep never shows them stale. Uses the owner connection (the app role may not write notifications). */
export const runDueTimersFor = async (exec: Exec, userId: string, now = new Date()): Promise<TimerReport> => sendEmails(await sweep(exec, now, userId, true))
