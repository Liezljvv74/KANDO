import { sql, type SQL } from 'drizzle-orm'
import type { bookings, db } from '@kando/db'
import type { Exec } from '../providers/eligibility'
import { notifyBookingEvent, type BookingKind } from './notify'
import { CUSTOMERS_WAITING_NOTICE_HOURS, PAY_GRACE_MINUTES, paymentsEnabled } from '../payments/rules'
import { CUSTOMERS_WAITING_CRON_TOLERANCE_HOURS, noticeCustomersWaiting } from '../payments/watches'
import { IGNORED_FLAG_DAYS, IGNORED_LIMIT, IGNORED_WINDOW_DAYS } from './rules'
import { ASK_DONE_HOURS, CONFIRM_REMINDER_DAYS, endOf, NO_ACTION_STAFF_DAYS, REVIEW_VISIBLE_DAYS, STOP_ANSWER_DAYS } from './ending-rules'
import { RELEASE_FAILED, tryRelease } from './finish'
import { resolveNoShows, trySettleCancelled } from './cancel'
import { openSystemDispute } from './disputes'
import { tryApplyDecision } from '../admin/bookings'
import { describeError } from '../log-error'
import { issueDueInvoices } from '../invoices/issue'

/**
 * The automatic releases stop starting new ones after this time: about half of the cron route's maxDuration (60 s), as
 * each release is a settle with gateway calls (15 s timeout, retries). The rest go in the next run.
 */
export const RELEASE_BUDGET_MS = 30_000
/** A hard cap per run on top of the time budget. */
export const RELEASES_HARD_CAP = 200

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
  /** No-show reports that stood after 48 hours without objection (the booking is cancelled; the money follows). */
  noShowsResolved: number
  /** Cancelled, paid bookings settled by the timer (a no-show that stood, or a cancellation whose settle failed before). */
  cancelsSettled: number
  /** Stopped jobs sent to staff (a no-response dispute): the stated amount unanswered, or never stated, for STOP_ANSWER_DAYS. */
  stopsToStaff: number
  /** Undecided disputes past their decideBy that got their one `dispute-overdue` staff flag. */
  overdueDisputes: number
  /** Providers still silent IGNORED_FLAG_DAYS after a requests-ignored notice: one `ignored-requests` staff flag each. */
  ignoredNoticeFlags: number
  /** Reviews shown by their 7 days (the other side wrote none): both sides got their one `review-visible`. */
  reviewsShown: number
  /** Staff decisions whose money step failed before, carried out now (admin/bookings.ts applyDecision). */
  decisionsApplied: number
  /** Invoices and receipts issued for booking groups now final (the ending paths issue at once; this is the retry). */
  invoicesIssued: number
}

/**
 * Every rule is ONE statement (UPDATE .. RETURNING feeding the notification INSERT), so a concurrent run cannot
 * process a row twice and a second run finds nothing. Deadlines are the stored columns, so a late run is still right.
 * Notification payloads carry ids only. userId narrows every rule to rows of that user (customer or provider owner).
 */
type TimerEvent = { userId: string; kind: BookingKind; payload: Record<string, string> }
/** Counts the rows of CTE `from` and returns the notification rows CTE `n` inserted (ids only), so their emails can follow. */
const result = (from: string) => sql`SELECT (SELECT count(*) FROM ${sql.identifier(from)})::int AS n, (SELECT coalesce(jsonb_agg(jsonb_build_object('userId', user_id, 'kind', kind, 'payload', payload)), '[]'::jsonb) FROM n) AS ev`

async function sweep(exec: Exec, now: Date, userId?: string, expiryOnly = false, timeUp: () => boolean = () => false): Promise<TimerReport & { events: TimerEvent[] }> {
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
        ${scoped(sql`customer_id = ${userId}`, ownedBy('provider_id'))} RETURNING id, customer_id, parent_booking_id),
    n AS (INSERT INTO notifications (user_id, kind, payload, created_at) SELECT customer_id, 'request-expired', jsonb_build_object('requestId', id), ${t}::timestamptz FROM e WHERE parent_booking_id IS NULL RETURNING user_id, kind, payload)
    ${result('e')}`)

  // An expired additional task's request tells nobody (no "try a different provider" while the booking runs) and does not
  // count toward the provider's requests-ignored notice.
  // The request stays 'quoted'; it simply has no live quote any more.
  const quotesExpired = await count(sql`
    WITH e AS (UPDATE quotes SET status = 'expired' WHERE status = 'sent' AND expires_at <= ${t}::timestamptz
        ${scoped(ownedBy('provider_id'), sql`request_id IN (SELECT id FROM requests WHERE customer_id = ${userId})`)} RETURNING id)
    SELECT count(*)::int AS n FROM e`)

  const bookingScope = scoped(sql`customer_id = ${userId}`, ownedBy('provider_id'))
  // both expiries lock their rows in id order, as lockFamily and account deletion do (two of one root's additional tasks
  // expiring while the root is cancelled can otherwise deadlock)
  const lapsed = sql`status = 'proposed' AND answer_by <= ${t}::timestamptz ${bookingScope}`
  const unpaid = sql`status = 'awaiting-payment' AND pay_by + make_interval(mins => ${PAY_GRACE_MINUTES}) <= ${t}::timestamptz ${bookingScope}`
  const proposalsLapsed = await count(sql`
    WITH e AS (UPDATE bookings SET status = 'expired', updated_at = ${t}::timestamptz WHERE ${inIdOrder(lapsed)} AND ${lapsed} RETURNING id, customer_id),
    n AS (INSERT INTO notifications (user_id, kind, payload, created_at) SELECT customer_id, 'booking-expired', jsonb_build_object('bookingId', id), ${t}::timestamptz FROM e RETURNING user_id, kind, payload)
    ${result('e')}`)

  // PAY_GRACE_MINUTES after pay_by: a payment made at the deadline may still be on its way (the webhook confirms it if the
  // time is still free). The slot itself stops being held at pay_by (slotIsHeld, busy_times) and no pay link is given after it.
  const unpaidExpired = await count(sql`
    WITH e AS (UPDATE bookings SET status = 'expired', updated_at = ${t}::timestamptz WHERE ${inIdOrder(unpaid)} AND ${unpaid} RETURNING id, customer_id, provider_id),
    n AS (INSERT INTO notifications (user_id, kind, payload, created_at)
      SELECT u, 'booking-expired', jsonb_build_object('bookingId', id), ${t}::timestamptz
      FROM (SELECT id, customer_id AS u FROM e UNION ALL SELECT e.id, p.owner_id FROM e JOIN providers p ON p.id = e.provider_id) x RETURNING user_id, kind, payload)
    ${result('e')}`)

  // The lazy per-user path stops here: money and ending rules (reminders, releases, the silent provider) run in the cron only.
  if (expiryOnly) return { requestsExpired, quotesExpired, proposalsLapsed, unpaidExpired, remindersSent: 0, ignoredNotices: 0, customersWaiting: 0, confirmReminders: 0, autoReleased: 0, askedDone: 0, sentToStaff: 0, noShowsResolved: 0, cancelsSettled: 0, stopsToStaff: 0, overdueDisputes: 0, ignoredNoticeFlags: 0, reviewsShown: 0, decisionsApplied: 0, invoicesIssued: 0, events }

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
      WHERE r.status = 'expired' AND r.parent_booking_id IS NULL AND r.updated_at > ${t}::timestamptz - make_interval(days => ${IGNORED_WINDOW_DAYS})
      GROUP BY p.owner_id HAVING count(*) >= ${IGNORED_LIMIT}),
    n AS (INSERT INTO notifications (user_id, kind, payload, created_at) SELECT owner_id, 'requests-ignored', '{}'::jsonb, ${t}::timestamptz FROM i
      WHERE NOT EXISTS (SELECT 1 FROM notifications x WHERE x.user_id = i.owner_id AND x.kind = 'requests-ignored' AND x.created_at > ${t}::timestamptz - make_interval(days => ${IGNORED_WINDOW_DAYS})) RETURNING user_id, kind, payload)
    ${result('n')}`)
  })

  // A review shown by its 7 days (the other side wrote none) tells both sides once (`review-visible`; a second
  // review shows both at once and writeReview tells them). One statement marking reveal_told_at, so a concurrent run
  // cannot tell twice. Looks back REVIEW_VISIBLE_DAYS only, so a long-past reveal is never told late.
  const reviewsShown = await count(sql`
    WITH s AS (UPDATE reviews SET reveal_told_at = ${t}::timestamptz
      WHERE reveal_told_at IS NULL AND NOT hidden AND visible_at <= ${t}::timestamptz AND visible_at > ${t}::timestamptz - make_interval(days => ${REVIEW_VISIBLE_DAYS})
      RETURNING booking_id, author_id, subject_id),
    n AS (INSERT INTO notifications (user_id, kind, payload, created_at)
      SELECT v.u, 'review-visible', jsonb_build_object('bookingId', s.booking_id), ${t}::timestamptz FROM s CROSS JOIN LATERAL (VALUES (s.author_id), (s.subject_id)) v(u) RETURNING user_id, kind, payload)
    ${result('s')}`)

  // "Customers want to book you" (payments on only): the summary for watchers who joined after the provider's last notice
  // (the first tap is told at once, watches.ts). The gate tolerates the cron starting a little early on the next day.
  const waiting = paymentsEnabled() ? await noticeCustomersWaiting(exec, now, CUSTOMERS_WAITING_NOTICE_HOURS - CUSTOMERS_WAITING_CRON_TOLERANCE_HOURS) : []
  for (const w of waiting) events.push({ userId: w.userId, kind: 'customers-waiting', payload: { count: String(w.count) } })
  const customersWaiting = waiting.length

  const endings = await endingRules(exec, now, count, timeUp)
  return { requestsExpired, quotesExpired, proposalsLapsed, unpaidExpired, remindersSent: quoteReminders + half + last, ignoredNotices, customersWaiting, reviewsShown, ...endings, autoReleased: 0, noShowsResolved: 0, cancelsSettled: 0, decisionsApplied: 0, invoicesIssued: 0, events }
}

// The booking's own dispute or chargeback: an additional task is paid out independently of its root (spec 3.12); the
// children a root's no-show covers are left alone by their own no_show (settle checks the root's report as well)
const noOpenDispute = sql`NOT EXISTS (SELECT 1 FROM disputes d WHERE d.booking_id = bookings.id AND d.decided_at IS NULL)`
const noChargeback = sql`NOT EXISTS (SELECT 1 FROM staff_flags f WHERE f.kind = 'chargeback' AND f.ref_id = bookings.id::text AND f.resolved_at IS NULL)`
/**
 * The end the silent-provider rules count from: the agreed end, or the payment if later (an additional task keeps its
 * parent's start, which may be long past when it is paid). A root is paid before its start, so for it this is the end.
 */
const endAt = sql`greatest(start_at + make_interval(mins => duration_min), paid_at)`
const endOrPaid = (b: typeof bookings.$inferSelect) => Math.max(endOf(b).getTime(), b.paidAt?.getTime() ?? 0)
/**
 * The booking rows of `pred`, locked in id order (account deletion locks a person's bookings by id too, so the two never
 * wait on each other in opposite orders). The lock re-checks `pred` on a row changed meanwhile.
 */
const inIdOrder = (pred: SQL) => sql`id IN (SELECT id FROM bookings WHERE ${pred} ORDER BY id FOR UPDATE)`

/** After "Finished" (Task 2 rules), and the provider who never taps it (spec 7a). Cron only; the releases run last (releaseDue). */
async function endingRules(exec: Exec, now: Date, count: (q: SQL) => Promise<number>, timeUp: () => boolean) {
  const t = now.toISOString()
  // Reminder number sent + 1 once its day mark has passed (dueConfirmReminder): one per booking and run, so a late run
  // sends the oldest unsent one and the next run the next. Never once the release is due or a dispute is open.
  const days = sql`(ARRAY[${sql.join(CONFIRM_REMINDER_DAYS.map((d) => sql`${d}::int`), sql`, `)}])[confirm_reminders_sent + 1]`
  const remind = sql`status = 'finished' AND confirm_by > ${t}::timestamptz AND confirm_reminders_sent < ${CONFIRM_REMINDER_DAYS.length}
        AND finished_at + make_interval(days => ${days}) <= ${t}::timestamptz AND ${noOpenDispute}`
  const confirmReminders = await count(sql`
    WITH r AS (UPDATE bookings SET confirm_reminders_sent = confirm_reminders_sent + 1, updated_at = ${t}::timestamptz WHERE ${inIdOrder(remind)} AND ${remind} RETURNING id, customer_id),
    n AS (INSERT INTO notifications (user_id, kind, payload, created_at) SELECT customer_id, 'confirm-reminder', jsonb_build_object('bookingId', id), ${t}::timestamptz FROM r RETURNING user_id, kind, payload)
    ${result('r')}`)

  // The provider never tapped "Finished": 24 hours after the end the customer is asked once (they may then confirm).
  // A reported no-show is left alone here: it ends by objection or after 48 hours (cancel.ts).
  const ask = sql`status = 'confirmed' AND no_show IS NULL AND asked_done_at IS NULL AND ${endAt} + make_interval(hours => ${ASK_DONE_HOURS}) <= ${t}::timestamptz`
  const askedDone = await count(sql`
    WITH r AS (UPDATE bookings SET asked_done_at = ${t}::timestamptz, updated_at = ${t}::timestamptz WHERE ${inIdOrder(ask)} AND ${ask} RETURNING id, customer_id),
    n AS (INSERT INTO notifications (user_id, kind, payload, created_at) SELECT customer_id, 'was-job-done', jsonb_build_object('bookingId', id), ${t}::timestamptz FROM r RETURNING user_id, kind, payload)
    ${result('r')}`)

  // Nobody acted within 7 days after the end: the booking goes to staff as a system dispute (no-response), the money
  // stays frozen (settle refuses while it is open) until staff decide; both sides are told. Only once the customer was
  // asked at least 24 hours earlier, so a late run never asks and escalates at the same time. openSystemDispute locks
  // each row and re-checks the rule (a racing confirm, report or stop wins or loses whole), so it happens once.
  const sentToStaff = await toStaff(
    exec,
    now,
    timeUp,
    sql`status = 'confirmed' AND no_show IS NULL AND ${endAt} + make_interval(days => ${NO_ACTION_STAFF_DAYS}) <= ${t}::timestamptz
        AND asked_done_at IS NOT NULL AND asked_done_at + make_interval(hours => ${ASK_DONE_HOURS}) <= ${t}::timestamptz`,
    (b) =>
      b.status === 'confirmed' && !b.noShow && b.askedDoneAt !== null && b.askedDoneAt.getTime() + ASK_DONE_HOURS * HOUR <= now.getTime() && endOrPaid(b) + NO_ACTION_STAFF_DAYS * DAY <= now.getTime(),
  )

  // A stopped job whose stated amount the customer left unanswered (or whose provider never stated one) for
  // STOP_ANSWER_DAYS goes to staff the same way. An agreed amount (confirm_by set) is paid by releaseDue instead.
  const stopsToStaff = await toStaff(
    exec,
    now,
    timeUp,
    sql`status = 'stopped' AND confirm_by IS NULL AND coalesce(stop_stated_at, stopped_at) + make_interval(days => ${STOP_ANSWER_DAYS}) <= ${t}::timestamptz`,
    (b) => b.status === 'stopped' && b.confirmBy === null && (b.stopStatedAt ?? b.stoppedAt ?? now).getTime() + STOP_ANSWER_DAYS * DAY <= now.getTime(),
  )

  // One flag per dispute that staff did not decide by its deadline (never again, even once resolved).
  const overdueDisputes = await count(sql`
    WITH i AS (INSERT INTO staff_flags (kind, ref_id, user_id, note, created_at)
      SELECT 'dispute-overdue', d.booking_id::text, b.customer_id, 'reason: ' || d.reason, ${t}::timestamptz FROM disputes d JOIN bookings b ON b.id = d.booking_id
      WHERE d.decided_at IS NULL AND d.decide_by <= ${t}::timestamptz
        AND NOT EXISTS (SELECT 1 FROM staff_flags f WHERE f.kind = 'dispute-overdue' AND f.ref_id = d.booking_id::text)
      ON CONFLICT DO NOTHING RETURNING id)
    SELECT count(*)::int AS n FROM i`)

  // A provider still published IGNORED_FLAG_DAYS after their latest requests-ignored notice, with no quote sent and no
  // booking answered (accepted, declined or a new time proposed) since: one flag per notice. Nothing is removed
  // automatically; staff decide (the existing suspension tool).
  const ignoredNoticeFlags = await count(sql`
    WITH n AS (SELECT user_id, max(created_at) AS at FROM notifications WHERE kind = 'requests-ignored' GROUP BY user_id),
    c AS (SELECT p.id, p.owner_id FROM providers p JOIN n ON n.user_id = p.owner_id
      WHERE p.status = 'published' AND n.at + make_interval(days => ${IGNORED_FLAG_DAYS}) <= ${t}::timestamptz
        AND NOT EXISTS (SELECT 1 FROM quotes q WHERE q.provider_id = p.id AND q.created_at > n.at)
        AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.provider_id = p.id AND (b.accepted_at > n.at OR (b.updated_at > n.at AND (b.status = 'declined' OR b.counter_by = 'provider'))))
        AND NOT EXISTS (SELECT 1 FROM staff_flags f WHERE f.kind = 'ignored-requests' AND f.ref_id = p.id::text AND f.created_at >= n.at)),
    i AS (INSERT INTO staff_flags (kind, ref_id, user_id, note, created_at)
      SELECT 'ignored-requests', id::text, owner_id, ${`no answer ${IGNORED_FLAG_DAYS} days after the requests-ignored notice`}, ${t}::timestamptz FROM c
      ON CONFLICT DO NOTHING RETURNING id)
    SELECT count(*)::int AS n FROM i`)

  return { confirmReminders, askedDone, sentToStaff, stopsToStaff, overdueDisputes, ignoredNoticeFlags }
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
/**
 * Sends the bookings of `pred` to staff as no-response disputes, one at a time in id order (openSystemDispute locks the
 * row and re-checks `still`, the same rule in code); a failure is logged and the next run retries. The number opened.
 */
async function toStaff(exec: Exec, now: Date, timeUp: () => boolean, pred: SQL, still: (b: typeof bookings.$inferSelect) => boolean): Promise<number> {
  const due = (await exec.execute<{ id: string }>(sql`SELECT id FROM bookings WHERE ${pred} ORDER BY id`)).rows
  let n = 0
  for (const { id } of due) {
    if (timeUp()) break // the run's time budget; the rest go in the next run
    try {
      if (await openSystemDispute(exec, id, 'no-response', now, { when: still })) n++
    } catch (e) {
      console.error(`[timers] booking ${id} not sent to staff: ${describeError(e)}`)
    }
  }
  return n
}

export type ReleaseOptions = {
  /**
   * Stop STARTING per-booking steps (staff hand-overs, no-show resolutions, releases) once this much time has passed since
   * the run began (a started one finishes). Default RELEASE_BUDGET_MS. The SQL rules always run.
   */
  budgetMs?: number
  /** Milliseconds now; injected by tests. */
  clock?: () => number
}

/**
 * The money steps due: 7 days without an answer (or a confirmation whose release failed): the payment is made; and a
 * cancelled, paid booking not yet settled (a no-show that stood, or a cancellation whose settle failed): settled with its
 * share (cancel.ts). One booking at a time (settle), inside a time budget and a hard cap; a failure is logged and flagged
 * (attemptMoney) and never stops the loop; the booking stays due and a later run retries it. Frozen bookings (undecided
 * dispute, open chargeback flag) are not picked, and neither is a cancelled booking that had a dispute (staff settle
 * those with their decision); a finished one with a reported no-show is left alone. A `disputed` booking whose dispute
 * staff decided but whose money step failed (admin/bookings.ts) is carried out with the stored share. Bookings whose
 * earlier attempt failed (open flag) come last, so they never hold back the others.
 */
async function releaseDue(exec: Exec, now: Date, timeUp: () => boolean): Promise<{ autoReleased: number; cancelsSettled: number; decisionsApplied: number }> {
  const t = now.toISOString()
  const due = (
    await exec.execute<{ id: string; customer_id: string; status: string }>(sql`
    SELECT id, customer_id, status FROM bookings
    WHERE ((status = 'finished' AND confirm_by <= ${t}::timestamptz AND no_show IS NULL)
        OR (status = 'stopped' AND confirm_by <= ${t}::timestamptz AND stop_amount IS NOT NULL)
        OR (status = 'cancelled' AND paid_at IS NOT NULL AND released_at IS NULL AND NOT EXISTS (SELECT 1 FROM disputes d WHERE d.booking_id = bookings.id))
        OR (status = 'disputed' AND EXISTS (SELECT 1 FROM disputes d WHERE d.booking_id = bookings.id AND d.decided_at IS NOT NULL)))
      AND ${noOpenDispute} AND ${noChargeback}
    ORDER BY EXISTS (SELECT 1 FROM staff_flags f WHERE f.kind = 'payment-unprocessed' AND f.ref_id = bookings.id::text AND f.resolved_at IS NULL AND f.note LIKE ${`${RELEASE_FAILED}%`}),
      CASE WHEN status = 'cancelled' THEN cancelled_at ELSE confirm_by END, id
    LIMIT ${RELEASES_HARD_CAP}`)
  ).rows
  const done = { autoReleased: 0, cancelsSettled: 0, decisionsApplied: 0 }
  for (const b of due) {
    if (timeUp()) break
    if (b.status === 'disputed') done.decisionsApplied += Number(await tryApplyDecision(exec, b.id, b.customer_id, now))
    else if (b.status !== 'cancelled') done.autoReleased += Number(await tryRelease(exec, b.id, b.customer_id, now))
    else done.cancelsSettled += Number(await trySettleCancelled(b.id, b.customer_id, now))
  }
  return done
}

/**
 * Sends the emails and pushes of the in-app rows a sweep just wrote (the SQL writes the row, notifyBookingEvent sends only
 * the email and push for these kinds, so there is one row, one email and one push per event). Never throws. The sweep has
 * committed before this runs: the runners take the pool only (each statement and step commits on its own), never an open
 * transaction, so no email or push can go out for a write that is later rolled back.
 */
async function sendEmails({ events, ...report }: TimerReport & { events: TimerEvent[] }): Promise<TimerReport> {
  for (const e of events) await notifyBookingEvent(e.kind, e.userId, e.payload)
  return report
}

/**
 * The scheduled sweep (the pool, never an open transaction: see sendEmails). The money releases run LAST, after every other rule and its
 * emails: a timeout or an error in the release loop can no longer drop the day's reminders, expiries or silent-provider steps.
 */
export async function runDueTimers(exec: typeof db, now: Date, release: ReleaseOptions = {}): Promise<TimerReport> {
  // one budget for the whole run, measured from its start: the loops before the releases count against it too
  const { budgetMs = RELEASE_BUDGET_MS, clock = Date.now } = release
  const started = clock()
  const timeUp = () => clock() - started >= budgetMs
  const report = await sendEmails(await sweep(exec, now, undefined, false, timeUp))
  const noShowsResolved = await resolveNoShows(exec, now, timeUp)
  const released = await releaseDue(exec, now, timeUp)
  // last, inside the same budget: the groups the releases above made final were invoiced by them already (attemptMoney);
  // this catches the rest (a group ended by an expiry, a PDF a storage failure left out, an earlier failure)
  return { ...report, noShowsResolved, ...released, invoicesIssued: await issueDueInvoices(exec, now, { timeUp }) }
}

/** The four expiry rules for one user's own rows (no reminders, no ignored notice: those stay in the cron run): a late sweep never shows them stale. Uses the owner connection (the app role may not write notifications). */
export const runDueTimersFor = async (exec: typeof db, userId: string, now = new Date()): Promise<TimerReport> => sendEmails(await sweep(exec, now, userId, true))
