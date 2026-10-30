import { sql, type SQL } from 'drizzle-orm'
import type { db } from '@kando/db'
import type { Exec } from '../providers/eligibility'
import { notifyBookingEvent, type BookingKind } from './notify'
import { CUSTOMERS_WAITING_NOTICE_HOURS, PAY_GRACE_MINUTES, paymentsEnabled } from '../payments/rules'
import { CUSTOMERS_WAITING_CRON_TOLERANCE_HOURS, noticeCustomersWaiting } from '../payments/watches'
import { IGNORED_LIMIT, IGNORED_WINDOW_DAYS } from './rules'
import { addWorkingDays, ASK_DONE_HOURS, CONFIRM_REMINDER_DAYS, DISPUTE_DECISION_WORKING_DAYS, NO_ACTION_STAFF_DAYS } from './ending-rules'
import { tryRelease } from './finish'

/** Automatic releases per run: each one is a settle with gateway calls (one booking at a time), so a run stays well inside the function timeout; the rest go in the next run. */
export const RELEASES_PER_RUN = 20

export type TimerReport = {
  requestsExpired: number
  quotesExpired: number
  proposalsLapsed: number
  unpaidExpired: number
  remindersSent: number
  ignoredNotices: number
  customersWaiting: number
  confirmReminders: number
  autoReleased: number
  askedDone: number
  sentToStaff: number
}

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

  // The lazy per-user path stops here: money and ending rules (reminders, releases, the silent provider) run in the cron only.
  if (expiryOnly) return { requestsExpired, quotesExpired, proposalsLapsed, unpaidExpired, remindersSent: 0, ignoredNotices: 0, customersWaiting: 0, confirmReminders: 0, autoReleased: 0, askedDone: 0, sentToStaff: 0, events }

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

  // "Customers want to book you" (payments on only): the summary for watchers who joined after the provider's last notice
  // (the first tap is told at once, watches.ts). The gate tolerates the cron starting a little early on the next day.
  const waiting = paymentsEnabled() ? await noticeCustomersWaiting(exec, now, CUSTOMERS_WAITING_NOTICE_HOURS - CUSTOMERS_WAITING_CRON_TOLERANCE_HOURS) : []
  for (const w of waiting) events.push({ userId: w.userId, kind: 'customers-waiting', payload: { count: String(w.count) } })
  const customersWaiting = waiting.length

  const endings = await endingRules(exec, now, count)
  return { requestsExpired, quotesExpired, proposalsLapsed, unpaidExpired, remindersSent: quoteReminders + half + last, ignoredNotices, customersWaiting, ...endings, events }
}

const noOpenDispute = sql`NOT EXISTS (SELECT 1 FROM disputes d WHERE d.booking_id = bookings.id AND d.decided_at IS NULL)`
const endAt = sql`start_at + make_interval(mins => duration_min)`

/** After "Finished" (Task 2 rules), and the provider who never taps it (spec 7a). Cron only. */
async function endingRules(exec: Exec, now: Date, count: (q: SQL) => Promise<number>) {
  const t = now.toISOString()
  // Reminder number sent + 1 once its day mark has passed (dueConfirmReminder): one per booking and run, so a late run
  // sends the oldest unsent one and the next run the next. Never once the release is due or a dispute is open.
  const days = sql`(ARRAY[${sql.join(CONFIRM_REMINDER_DAYS.map((d) => sql`${d}::int`), sql`, `)}])[confirm_reminders_sent + 1]`
  const confirmReminders = await count(sql`
    WITH r AS (UPDATE bookings SET confirm_reminders_sent = confirm_reminders_sent + 1, updated_at = ${t}::timestamptz
        WHERE status = 'finished' AND confirm_by > ${t}::timestamptz AND confirm_reminders_sent < ${CONFIRM_REMINDER_DAYS.length}
        AND finished_at + make_interval(days => ${days}) <= ${t}::timestamptz AND ${noOpenDispute} RETURNING id, customer_id),
    n AS (INSERT INTO notifications (user_id, kind, payload, created_at) SELECT customer_id, 'confirm-reminder', jsonb_build_object('bookingId', id), ${t}::timestamptz FROM r RETURNING user_id, kind, payload)
    ${result('r')}`)

  // 7 days without an answer: the payment is made. One booking at a time (settle), capped per run; a failure is logged and
  // flagged by tryRelease and never stops the loop; the booking stays due and the next run retries it.
  // ponytail: oldest due first, so more than RELEASES_PER_RUN bookings that keep failing would hold back the rest (each is flagged to staff).
  const due = (
    await exec.execute<{ id: string; customer_id: string }>(sql`
    SELECT id, customer_id FROM bookings WHERE status = 'finished' AND confirm_by <= ${t}::timestamptz AND ${noOpenDispute}
    ORDER BY confirm_by, id LIMIT ${RELEASES_PER_RUN}`)
  ).rows
  let autoReleased = 0
  for (const b of due) if (await tryRelease(exec, b.id, b.customer_id, now)) autoReleased++

  // The provider never tapped "Finished": 24 hours after the end the customer is asked once (they may then confirm).
  const askedDone = await count(sql`
    WITH r AS (UPDATE bookings SET asked_done_at = ${t}::timestamptz, updated_at = ${t}::timestamptz
        WHERE status = 'confirmed' AND asked_done_at IS NULL AND ${endAt} + make_interval(hours => ${ASK_DONE_HOURS}) <= ${t}::timestamptz RETURNING id, customer_id),
    n AS (INSERT INTO notifications (user_id, kind, payload, created_at) SELECT customer_id, 'was-job-done', jsonb_build_object('bookingId', id), ${t}::timestamptz FROM r RETURNING user_id, kind, payload)
    ${result('r')}`)

  // Nobody acted within 7 days after the end: the booking goes to staff as a system dispute (no-response), the money
  // stays frozen (settle refuses while it is open) until staff decide. The status change makes it happen once.
  const decideBy = addWorkingDays(now, DISPUTE_DECISION_WORKING_DAYS).toISOString()
  const sentToStaff = await count(sql`
    WITH s AS (UPDATE bookings SET status = 'disputed', updated_at = ${t}::timestamptz
        WHERE status = 'confirmed' AND ${endAt} + make_interval(days => ${NO_ACTION_STAFF_DAYS}) <= ${t}::timestamptz RETURNING id),
    d AS (INSERT INTO disputes (booking_id, reason, description, created_at, decide_by)
      SELECT id, 'no-response', '', ${t}::timestamptz, ${decideBy}::timestamptz FROM s ON CONFLICT (booking_id) DO NOTHING RETURNING id)
    SELECT (SELECT count(*) FROM s)::int AS n`)

  return { confirmReminders, autoReleased, askedDone, sentToStaff }
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
