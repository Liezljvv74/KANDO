import { and, asc, count, desc, eq, ilike, isNotNull, isNull, like as sqlLike, or, sql } from 'drizzle-orm'
import { bookings, db, disputes, ledgerEntries, providers, reviews, staffFlags, users, type Tx } from '@kando/db'
import type { AdminListQuery, DisputeDecision, ReviewHide, StaffRefund } from '@kando/contract'
import { lockFamily } from '../bookings/additional'
import { ownerOf, providerNoShowRule, trySettleCancelled } from '../bookings/cancel'
import { toDispute } from '../bookings/disputes'
import { REVIEW_VISIBLE_DAYS } from '../bookings/ending-rules'
import { attemptMoney, lockRow, RELEASE_FAILED } from '../bookings/finish'
import { notifyBookingEvent } from '../bookings/notify'
import { logStaffThreadAccess } from '../chat/staff'
import { paidAmount } from '../payments/ledger'
import { toCents } from '../payments/rules'
import { settle } from '../payments/settle'
import type { Exec } from '../providers/eligibility'
import { fail } from '../providers/http'
import { filterOf, isUuid, like, notFound, ok, orderOf, pageOf, textOf } from './common'

type Row = typeof bookings.$inferSelect
type DisputeRow = typeof disputes.$inferSelect
const DAY = 86_400_000
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null)
const num = (v: string | null) => (v === null ? null : Number(v))
const notFoundError = () => fail(404, { error: 'Not found' })

const openChargeback = async (o: Exec, bookingId: string) =>
  (await o.select({ id: staffFlags.id }).from(staffFlags).where(and(eq(staffFlags.kind, 'chargeback'), eq(staffFlags.refId, bookingId), isNull(staffFlags.resolvedAt)))).length > 0

/** The dispute as staff see it: the party DTO plus who decided (staff only). */
const toAdminDispute = (d: DisputeRow) => ({ ...toDispute(d), decidedBy: d.decidedBy })

/** Tells both sides a booking ended by staff (`kind` with the written reason in the email) and asks a completed root for reviews. */
async function tellBoth(kind: 'dispute-decided' | 'refund-issued', b: Row, reason: string, status: string, now: Date): Promise<void> {
  const owner = await ownerOf(b.providerId)
  await notifyBookingEvent(kind, b.customerId, { bookingId: b.id, reason })
  if (owner) await notifyBookingEvent(kind, owner, { bookingId: b.id, reason, role: 'provider' })
  // completed: the job counts as done, so both may review it (refunded or cancelled jobs never are, reviews.ts)
  if (status === 'completed' && !b.parentBookingId) {
    const date = new Date(now.getTime() + REVIEW_VISIBLE_DAYS * DAY).toISOString()
    for (const u of [b.customerId, owner]) if (u) await notifyBookingEvent('review-requested', u, { bookingId: b.id, date })
  }
}

/**
 * An Administrator decides a dispute (one decision per dispute). Step 1, on the owner connection with the booking row and
 * then the dispute row locked: refuses a decided dispute (409 ALREADY_DECIDED: two staff clicking at once get exactly one
 * outcome), a booking that is no longer `disputed` (409 not-open), and an open chargeback flag (409 CHARGEBACK_OPEN: staff
 * resolve it first, settle stays frozen while it is open); the share is whole cents and for `partial` more than 0 and
 * below what was paid (400 INVALID_SHARE). The decision (decision, provider_share, reason, decided_by, decided_at) commits
 * before any money moves, so settle no longer sees an open dispute. Step 2 is applyDecision (settle with the stored share,
 * then the final status); if it fails the decision stays recorded, the booking stays `disputed`, staff are flagged
 * (`payment-unprocessed`), and the timer applies it on its next run (releaseDue). Returns the dispute, the booking status
 * and whether the money step went through.
 *   crash / failure point                 | left behind                              | the retry
 *   before step 1 commits                 | nothing                                  | staff click again
 *   after step 1, settle refuses / fails  | decided dispute, booking disputed, flag  | timer: applyDecision with the stored share
 *   settle partly done                    | its ledger rows (own connection)         | settle's own repair, same share
 *   after step 2, before the messages     | ended and settled, messages lost (logged)| nothing
 */
export async function decideDispute(exec: Exec, staffId: string, disputeId: string, input: DisputeDecision, now = new Date()) {
  const found = isUuid(disputeId) ? (await exec.select({ bookingId: disputes.bookingId }).from(disputes).where(eq(disputes.id, disputeId)))[0] : undefined
  if (!found) return notFoundError()
  const d = await exec.transaction(async (o) => {
    const b = await lockRow(o, found.bookingId)
    const [cur] = await o.select().from(disputes).where(eq(disputes.id, disputeId)).for('update')
    if (cur!.decidedAt) fail(409, { error: 'ALREADY_DECIDED' })
    if (b.status !== 'disputed') fail(409, { error: 'not-open' })
    if (await openChargeback(o, b.id)) fail(409, { error: 'CHARGEBACK_OPEN' })
    const paidC = b.paidAt && !b.releasedAt ? toCents(await paidAmount(o, b.id)) : 0
    let shareC = input.decision === 'full-payout' ? paidC : 0
    if (input.decision === 'partial') {
      const share = input.providerShare ?? 0
      shareC = toCents(share)
      if (shareC / 100 !== share || shareC <= 0 || shareC >= paidC) fail(400, { error: 'INVALID_SHARE' })
    }
    const [r] = await o
      .update(disputes)
      .set({ decision: input.decision, providerShare: (shareC / 100).toFixed(2), decisionReason: input.reason, decidedBy: staffId, decidedAt: now })
      .where(eq(disputes.id, disputeId))
      .returning()
    return r!
  })
  const b = (await db.select({ customerId: bookings.customerId }).from(bookings).where(eq(bookings.id, d.bookingId)))[0]!
  await tryApplyDecision(exec, d.bookingId, b.customerId, now)
  const status = (await db.select({ s: bookings.status }).from(bookings).where(eq(bookings.id, d.bookingId)))[0]!.s
  return { ...toAdminDispute(d), bookingStatus: status, applied: status !== 'disputed' }
}

/**
 * Carries out a recorded decision on its `disputed` booking (owner connection; the booking and its additional tasks
 * locked in id order; quiet once it has moved on, so the timer's retry and a racing apply end it once). Settles with the
 * stored share (full amount, the share, or 0) in the same transaction as the status: `refunded` for a full refund,
 * else `completed` (with completedAt; a full payout or a partial pays the provider something). A no-show objection: the report stands when the decision
 * favours the reporter (a provider no-show refunded in full, a customer no-show paid in full): the booking ends
 * `cancelled` with its `noShow` as after the 48 hours (resolveNoShow), and the provider no-show rule runs (warning, then a
 * staff flag); otherwise the report is overturned and cleared. For a root, its additional tasks covered by the report
 * follow: when it stands, paid ones are cancelled the same way (settled after the commit, the timer retries) and unpaid
 * ones withdrawn; when overturned, their no-show is cleared and they go on on their own clock. Afterwards both sides get
 * `dispute-decided` with the reason (and a completed root asks for reviews).
 */
export async function applyDecision(exec: Exec, bookingId: string, now: Date): Promise<void> {
  const r = await exec.transaction(async (o) => {
    const [b, kids] = await lockFamily(o, bookingId)
    if (b.status !== 'disputed') return null
    const [d] = await o.select().from(disputes).where(and(eq(disputes.bookingId, b.id), isNotNull(disputes.decidedAt)))
    if (!d) return fail(409, { error: 'DISPUTE_OPEN' })
    const shareC = toCents(Number(d.providerShare))
    if (b.paidAt && !b.releasedAt) await settle(o, b.id, shareC / 100)
    const objection = d.reason === 'no-show-objection' && b.noShow !== null
    const stands = objection && (b.noShow === 'provider' ? d.decision === 'full-refund' : d.decision === 'full-payout')
    const status = stands ? 'cancelled' : d.decision === 'full-refund' ? 'refunded' : 'completed'
    const [row] = await o
      .update(bookings)
      .set({ status, updatedAt: now, ...(status === 'completed' && { completedAt: now }), ...(stands && { cancelledAt: now }), ...(objection && !stands && { noShow: null, noShowReportedAt: null }) })
      .where(eq(bookings.id, b.id))
      .returning()
    const ended: Row[] = []
    if (objection && !b.parentBookingId) {
      for (const k of kids) {
        if (stands && k.status === 'confirmed')
          ended.push((await o.update(bookings).set({ status: 'cancelled', cancelledAt: now, noShow: k.noShow ?? b.noShow, noShowReportedAt: k.noShowReportedAt ?? b.noShowReportedAt, updatedAt: now }).where(eq(bookings.id, k.id)).returning())[0]!)
        else if (stands && (k.status === 'proposed' || k.status === 'awaiting-payment')) await o.update(bookings).set({ status: 'withdrawn', updatedAt: now }).where(eq(bookings.id, k.id))
        else if (!stands && k.status === 'confirmed' && k.noShow === b.noShow && k.noShowReportedAt?.getTime() === b.noShowReportedAt?.getTime())
          await o.update(bookings).set({ noShow: null, noShowReportedAt: null, updatedAt: now }).where(eq(bookings.id, k.id))
      }
    }
    return { b: row!, d, ended, warn: stands && (await providerNoShowRule(o, row!, now)) }
  })
  if (!r) return
  for (const k of r.ended) await trySettleCancelled(k.id, k.customerId, now)
  await tellBoth('dispute-decided', r.b, r.d.decisionReason!, r.b.status, now)
  const owner = r.warn ? await ownerOf(r.b.providerId) : undefined
  if (owner) await notifyBookingEvent('provider-warning', owner, { bookingId: r.b.id })
}

/** applyDecision that never throws (attemptMoney: logged, flagged to staff once, retried by the timer; a success closes the flag). */
export const tryApplyDecision = (exec: Exec, bookingId: string, customerId: string, now: Date): Promise<boolean> =>
  attemptMoney('decision', bookingId, customerId, now, () => applyDecision(exec, bookingId, now))

/** The statuses a staff refund settles: paid and open, or cancelled and not yet settled. A disputed booking is decided instead. */
const REFUNDABLE = ['confirmed', 'finished', 'stopped', 'cancelled']

/**
 * An Administrator settles an unsettled paid booking by hand (a refund after the payout is done in the Stripe dashboard):
 * the provider keeps `providerShare`, the customer gets the rest (settle: commission only on the share; 400 INVALID_SHARE
 * above what was paid; 409 DISPUTE_OPEN while a chargeback flag is open, the same freeze as everywhere). A disputed booking
 * is decided through its dispute (409 DISPUTE_OPEN); unpaid 409 NOT_PAID; settled 409 ALREADY_SETTLED; other statuses 409
 * not-open. Settle and the status share one owner transaction with the row locked: a cancelled booking stays `cancelled`,
 * otherwise `completed` (with completedAt) when the provider keeps something, `refunded` when not. A failure moves
 * nothing but the ledger rows the gateway confirmed; staff click again with the same share (another share: 409
 * SETTLEMENT_MISMATCH). A success closes an open `release failed` flag. Both sides get `refund-issued` with the reason.
 */
export async function staffRefund(exec: Exec, staffId: string, bookingId: string, input: StaffRefund, now = new Date()) {
  if (!isUuid(bookingId)) return notFoundError()
  const r = await exec.transaction(async (o) => {
    const b = await lockRow(o, bookingId)
    if (b.status === 'disputed') fail(409, { error: 'DISPUTE_OPEN' })
    if (!b.paidAt) fail(409, { error: 'NOT_PAID' })
    if (b.releasedAt) fail(409, { error: 'ALREADY_SETTLED' })
    if (!REFUNDABLE.includes(b.status)) fail(409, { error: 'not-open' })
    await settle(o, b.id, input.providerShare)
    const status = b.status === 'cancelled' ? 'cancelled' : toCents(input.providerShare) === 0 ? 'refunded' : 'completed'
    const [row] = await o.update(bookings).set({ status, updatedAt: now, ...(status === 'completed' && { completedAt: now }) }).where(eq(bookings.id, b.id)).returning()
    await o
      .update(staffFlags)
      .set({ resolvedAt: now, resolvedBy: staffId })
      .where(and(eq(staffFlags.kind, 'payment-unprocessed'), eq(staffFlags.refId, b.id), isNull(staffFlags.resolvedAt), sqlLike(staffFlags.note, `${RELEASE_FAILED}%`)))
    return row!
  })
  await tellBoth('refund-issued', r, input.reason, r.status, now)
  return { id: r.id, status: r.status }
}

const toAdminReview = (r: typeof reviews.$inferSelect) => ({
  id: r.id,
  bookingId: r.bookingId,
  authorRole: r.authorRole,
  stars: r.stars,
  text: r.text,
  hidden: r.hidden,
  hiddenReason: r.hiddenReason,
  createdAt: r.createdAt.toISOString(),
  visibleAt: iso(r.visibleAt),
})

/**
 * An Administrator hides a review that breaks the rules (with the reason, kept in hidden_reason), or shows it again (the
 * reason goes to the audit line; hidden_reason is cleared). Only `hidden` changes: the reveal time stays, so the blind
 * rule holds and a review never shows before it would have. Ratings and the provider page read `hidden` live (reviews.ts).
 */
export async function hideReview(exec: Exec, staffId: string, reviewId: string, input: ReviewHide) {
  const [r] = isUuid(reviewId) ? await exec.update(reviews).set({ hidden: input.hidden, hiddenReason: input.hidden ? input.reason : null }).where(eq(reviews.id, reviewId)).returning() : []
  if (!r) return notFoundError()
  console.log(JSON.stringify({ audit: 'review-moderated', time: new Date().toISOString(), staffId, reviewId: r.id, hidden: r.hidden }))
  return toAdminReview(r)
}

// ---- lists and details (Reviewers read them; no payment refs, gateway ids or payout accounts) ----

// raw column names: drizzle leaves a lone table's columns unqualified, which a subquery would resolve to its own table
const customer = sql<string>`(SELECT u.email FROM users u WHERE u.id = bookings.customer_id)`
const providerName = sql<string>`(SELECT p.public_name FROM providers p WHERE p.id = bookings.provider_id)`
const openDecideBy = sql<string | null>`(SELECT d.decide_by FROM disputes d WHERE d.booking_id = bookings.id AND d.decided_at IS NULL)`
const overdue = sql<boolean>`coalesce((SELECT d.decide_by < now() FROM disputes d WHERE d.booking_id = bookings.id AND d.decided_at IS NULL), false)`

/** Bookings, overdue disputes first (then the nearest deadline), then newest. Filters: `status`, `q` (customer email or provider name). */
async function listBookings(tx: Tx, q: AdminListQuery) {
  const f = filterOf(q)
  const text = textOf(f.q)
  const where = and(textOf(f.status) ? eq(bookings.status, textOf(f.status)!) : undefined, text ? or(ilike(customer, like(text)), ilike(providerName, like(text))) : undefined)
  const total = (await tx.select({ n: count() }).from(bookings).where(where))[0]!.n
  const rows = await tx
    .select({
      id: bookings.id,
      status: bookings.status,
      startAt: bookings.startAt,
      amount: bookings.amount,
      currency: bookings.currency,
      customerEmail: customer,
      providerName,
      parentBookingId: bookings.parentBookingId,
      paidAt: bookings.paidAt,
      releasedAt: bookings.releasedAt,
      createdAt: bookings.createdAt,
      disputeDecideBy: openDecideBy,
      disputeOverdue: overdue,
    })
    .from(bookings)
    .where(where)
    .orderBy(...orderOf(q.sort, { createdAt: bookings.createdAt, startAt: bookings.startAt }, [desc(overdue), sql`${openDecideBy} ASC NULLS LAST`, desc(bookings.createdAt), desc(bookings.id)]))
    .limit(pageOf(q).limit)
    .offset(pageOf(q).offset)
  return ok(
    rows.map((r) => ({ ...r, amount: Number(r.amount), startAt: iso(r.startAt), paidAt: iso(r.paidAt), releasedAt: iso(r.releasedAt), createdAt: iso(r.createdAt), disputeDecideBy: iso(r.disputeDecideBy) })),
    total,
  )
}

/** The chat of a booking, read only (no thread is created): its own thread, or its request's (through its quote). */
async function threadIdOf(exec: Exec, b: Pick<Row, 'id' | 'requestId' | 'quoteId'>): Promise<string | null> {
  const r = await exec.execute<{ id: string }>(sql`SELECT id FROM threads WHERE booking_id = ${b.id}
    OR request_id = ${b.requestId} OR request_id = (SELECT request_id FROM quotes WHERE id = ${b.quoteId})
    ORDER BY (booking_id = ${b.id}) DESC NULLS LAST LIMIT 1`)
  return r.rows[0]?.id ?? null
}

/** A booking's parties and money state, without refs; `paid` is charges minus refunds (exact). */
async function bookingSummary(exec: Exec, b: Row) {
  const [c] = await exec.select({ email: users.email, first: users.firstName, last: users.lastName }).from(users).where(eq(users.id, b.customerId))
  const [p] = await exec.select({ name: providers.publicName, ownerEmail: users.email }).from(providers).innerJoin(users, eq(users.id, providers.ownerId)).where(eq(providers.id, b.providerId))
  return {
    id: b.id,
    status: b.status,
    source: b.source,
    parentBookingId: b.parentBookingId,
    startAt: iso(b.startAt),
    durationMin: b.durationMin,
    onSite: b.onSite,
    amount: Number(b.amount),
    currency: b.currency,
    materialAmount: Number(b.materialAmount),
    paid: await paidAmount(exec, b.id),
    customerId: b.customerId,
    customerEmail: c?.email ?? null,
    customerName: [c?.first, c?.last].filter(Boolean).join(' ') || null,
    providerId: b.providerId,
    providerName: p?.name ?? null,
    providerEmail: p?.ownerEmail ?? null,
    paidAt: iso(b.paidAt),
    releasedAt: iso(b.releasedAt),
    finishedAt: iso(b.finishedAt),
    confirmBy: iso(b.confirmBy),
    completedAt: iso(b.completedAt),
    cancelledAt: iso(b.cancelledAt),
    cancelledBy: b.cancelledBy,
    lateCancel: b.lateCancel,
    noShow: b.noShow,
    noShowReportedAt: iso(b.noShowReportedAt),
    stoppedAt: iso(b.stoppedAt),
    stoppedBy: b.stoppedBy,
    stopAmount: num(b.stopAmount),
    stopNote: b.stopNote,
    createdAt: iso(b.createdAt),
    threadId: await threadIdOf(exec, b),
  }
}

/** One booking with its ledger rows (kind, amount, time), additional tasks and dispute. */
async function getBooking(tx: Tx, id: string) {
  const [b] = isUuid(id) ? await tx.select().from(bookings).where(eq(bookings.id, id)) : []
  if (!b) return notFound()
  const ledger = await tx.select({ kind: ledgerEntries.kind, amount: ledgerEntries.amount, createdAt: ledgerEntries.createdAt }).from(ledgerEntries).where(eq(ledgerEntries.bookingId, b.id)).orderBy(asc(ledgerEntries.createdAt), asc(ledgerEntries.id))
  const children = await tx.select({ id: bookings.id, status: bookings.status, amount: bookings.amount, releasedAt: bookings.releasedAt }).from(bookings).where(eq(bookings.parentBookingId, b.id)).orderBy(asc(bookings.createdAt))
  const [d] = await tx.select().from(disputes).where(eq(disputes.bookingId, b.id))
  return ok({
    ...(await bookingSummary(tx, b)),
    ledger: ledger.map((l) => ({ kind: l.kind, amount: Number(l.amount), createdAt: iso(l.createdAt) })),
    children: children.map((k) => ({ ...k, amount: Number(k.amount), releasedAt: iso(k.releasedAt) })),
    dispute: d ? toAdminDispute(d) : null,
  })
}

/** Disputes: undecided first (nearest deadline first), then decided (newest). Filters: `open` (boolean), `reason`. */
async function listDisputes(tx: Tx, q: AdminListQuery) {
  const f = filterOf(q)
  const where = and(typeof f.open === 'boolean' ? sql`(${disputes.decidedAt} IS NULL) = ${f.open}` : undefined, textOf(f.reason) ? eq(disputes.reason, textOf(f.reason)!) : undefined)
  const total = (await tx.select({ n: count() }).from(disputes).where(where))[0]!.n
  const rows = await tx
    .select({ d: disputes, status: bookings.status, customerEmail: customer, providerName })
    .from(disputes)
    .innerJoin(bookings, eq(bookings.id, disputes.bookingId))
    .where(where)
    .orderBy(...orderOf(q.sort, { createdAt: disputes.createdAt, decideBy: disputes.decideBy }, [sql`(${disputes.decidedAt} IS NOT NULL)`, asc(disputes.decideBy), desc(disputes.decidedAt), desc(disputes.id)]))
    .limit(pageOf(q).limit)
    .offset(pageOf(q).offset)
  const now = Date.now()
  return ok(
    rows.map((r) => ({ ...toAdminDispute(r.d), bookingStatus: r.status, customerEmail: r.customerEmail, providerName: r.providerName, overdue: !r.d.decidedAt && r.d.decideBy.getTime() < now })),
    total,
  )
}

/**
 * One dispute with its booking (parties, money) and the booking's chat id. Reading the evidence of a dispute is logged like a
 * chat read: one staff_access_log row with the dispute as the reason (flag_id) and the thread (or, without one, the booking) id.
 */
async function getAdminDispute(tx: Tx, id: string, staffId: string) {
  const [d] = isUuid(id) ? await tx.select().from(disputes).where(eq(disputes.id, id)) : []
  if (!d) return notFound()
  const b = (await tx.select().from(bookings).where(eq(bookings.id, d.bookingId)))[0]!
  const booking = await bookingSummary(tx, b)
  await logStaffThreadAccess(staffId, booking.threadId ?? b.id, d.id)
  return ok({ ...toAdminDispute(d), booking, paid: booking.paid, threadId: booking.threadId })
}

/** The refunds (ledger `refund` rows), newest first, with the booking and customer. Filter: `q` (customer email). */
async function listRefunds(tx: Tx, q: AdminListQuery) {
  const text = textOf(filterOf(q).q)
  const where = and(eq(ledgerEntries.kind, 'refund'), text ? ilike(customer, like(text)) : undefined)
  const total = (await tx.select({ n: count() }).from(ledgerEntries).innerJoin(bookings, eq(bookings.id, ledgerEntries.bookingId)).where(where))[0]!.n
  const rows = await tx
    .select({ id: ledgerEntries.id, bookingId: ledgerEntries.bookingId, amount: ledgerEntries.amount, currency: ledgerEntries.currency, createdAt: ledgerEntries.createdAt, bookingStatus: bookings.status, customerEmail: customer, providerName })
    .from(ledgerEntries)
    .innerJoin(bookings, eq(bookings.id, ledgerEntries.bookingId))
    .where(where)
    .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
    .limit(pageOf(q).limit)
    .offset(pageOf(q).offset)
  return ok(rows.map((r) => ({ ...r, amount: Number(r.amount), createdAt: iso(r.createdAt) })), total)
}

/** Every review (staff see the not-yet-shown ones too), newest first. Filters: `hidden` (boolean), `q` (author or subject email). */
async function listReviews(tx: Tx, q: AdminListQuery) {
  const f = filterOf(q)
  const text = textOf(f.q)
  const author = sql<string>`(SELECT u.email FROM users u WHERE u.id = reviews.author_id)`
  const subject = sql<string>`(SELECT u.email FROM users u WHERE u.id = reviews.subject_id)`
  const where = and(typeof f.hidden === 'boolean' ? eq(reviews.hidden, f.hidden) : undefined, text ? or(ilike(author, like(text)), ilike(subject, like(text))) : undefined)
  const total = (await tx.select({ n: count() }).from(reviews).where(where))[0]!.n
  const rows = await tx
    .select({ r: reviews, authorEmail: author, subjectEmail: subject })
    .from(reviews)
    .where(where)
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(pageOf(q).limit)
    .offset(pageOf(q).offset)
  return ok(rows.map((x) => ({ ...toAdminReview(x.r), authorEmail: x.authorEmail, subjectEmail: x.subjectEmail })), total)
}

export const bookingLists = { bookings: listBookings, disputes: listDisputes, refunds: listRefunds, reviews: listReviews }
export const bookingGets = { bookings: (tx: Tx, id: string) => getBooking(tx, id), disputes: getAdminDispute }
