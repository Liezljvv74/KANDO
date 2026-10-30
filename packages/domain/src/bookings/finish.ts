import { and, eq, isNull, like } from 'drizzle-orm'
import { bookings, db, providers, staffFlags, type Tx } from '@kando/db'
import type { Booking, FinishInput } from '@kando/contract'
import { isUuid } from '../admin/common'
import { flagForStaff } from '../chat/flags'
import { describeError } from '../log-error'
import { issueInvoiceFor } from '../invoices/issue'
import type { Exec } from '../providers/eligibility'
import { fail } from '../providers/http'
import { ownProvider } from '../providers/profile'
import { paidAmount } from '../payments/ledger'
import { toCents } from '../payments/rules'
import { settle } from '../payments/settle'
import { CONFIRM_DAYS, REVIEW_VISIBLE_DAYS } from './ending-rules'
import { notifyBookingEvent } from './notify'
import { toBooking } from './requests'

const DAY = 86_400_000
/** The note prefix of a staff flag for a failed release (timers.ts orders those bookings last). */
export const RELEASE_FAILED = 'release failed: '
const notFound = () => fail(404, { error: 'Not found' })

/** Which side the caller is on, read on the request transaction (RLS proves they are a party); 404 for anyone else. */
export async function sideOf(tx: Tx, userId: string, bookingId: string): Promise<'customer' | 'provider'> {
  const b = isUuid(bookingId) ? (await tx.select({ customerId: bookings.customerId, providerId: bookings.providerId }).from(bookings).where(eq(bookings.id, bookingId)))[0] : undefined
  if (!b) return notFound()
  if (b.customerId === userId) return 'customer'
  return (await ownProvider(tx, userId))?.id === b.providerId ? 'provider' : notFound()
}
export const lockRow = async (o: Exec, id: string) => (await o.select().from(bookings).where(eq(bookings.id, id)).for('update'))[0] ?? notFound()
export const reload = async (id: string) => toBooking((await db.select().from(bookings).where(eq(bookings.id, id)))[0]!)

/**
 * The provider's "Finished": from `confirmed`, once the agreed start has come (else 409 TOO_EARLY), once (else 409 not-open).
 * Starts the customer's 7 days (`confirmBy`) and stores the material part of the price (0 up to the booking amount, 400
 * INVALID_MATERIAL_AMOUNT). Owner connection (finished is an owner-only status), the row locked and re-checked.
 */
export async function finishJob(tx: Tx, userId: string, bookingId: string, input: FinishInput, now = new Date()): Promise<Booking> {
  if ((await sideOf(tx, userId, bookingId)) !== 'provider') fail(403, { error: 'not-your-turn' })
  const row = await db.transaction(async (o) => {
    const b = await lockRow(o, bookingId)
    if (b.status !== 'confirmed') fail(409, { error: 'not-open' })
    if (b.noShow) fail(409, { error: 'NO_SHOW_REPORTED' }) // a reported no-show ends by objection or its 48 hours (cancel.ts)
    if (now < b.startAt) fail(409, { error: 'TOO_EARLY' })
    const materialC = toCents(input.materialAmount ?? 0)
    if (materialC > toCents(Number(b.amount))) fail(400, { error: 'INVALID_MATERIAL_AMOUNT' })
    const confirmBy = new Date(now.getTime() + CONFIRM_DAYS * DAY)
    const [r] = await o.update(bookings).set({ status: 'finished', finishedAt: now, confirmBy, materialAmount: (materialC / 100).toFixed(2), updatedAt: now }).where(eq(bookings.id, b.id)).returning()
    return r!
  })
  await notifyBookingEvent('job-finished', row.customerId, { bookingId: row.id, date: row.confirmBy!.toISOString() })
  return toBooking(row)
}

/**
 * The customer's "the job is done": from `finished`, or from `confirmed` once they were asked "Was the job done?" (the
 * provider never tapped). Step 1 records the confirmation on its own (`confirmBy = now`, from `confirmed` also `finished`),
 * so the click is never lost; step 2 releases the payment. If the release fails (no payout account, gateway down ...) the
 * booking stays `finished` with its release due, staff are flagged, and the timer retries on every run. A second tap on a
 * completed booking returns it unchanged (200).
 */
export async function confirmJob(tx: Tx, userId: string, bookingId: string, now = new Date()): Promise<Booking> {
  return (await beginConfirmJob(tx, userId, bookingId, now))()
}

/**
 * confirmJob for a route: checks and records step 1 now and returns step 2 (the release, then the booking), which the route
 * runs after its request transaction (an AfterTransaction), so no Stripe call holds a request connection. Step 2 never throws
 * for the money (tryRelease: logged, flagged, retried by the timer).
 */
export async function beginConfirmJob(tx: Tx, userId: string, bookingId: string, now = new Date()): Promise<() => Promise<Booking>> {
  if ((await sideOf(tx, userId, bookingId)) !== 'customer') fail(403, { error: 'not-your-turn' })
  const b = await db.transaction(async (o) => {
    const b = await lockRow(o, bookingId)
    if (b.status === 'completed') return b
    const asked = b.status === 'confirmed' && b.askedDoneAt !== null
    if (b.status !== 'finished' && !asked) fail(409, { error: 'not-open' })
    if (b.noShow) fail(409, { error: 'NO_SHOW_REPORTED' })
    if (b.status === 'finished' && b.confirmBy && b.confirmBy <= now) return b // already due
    const [r] = await o.update(bookings).set({ ...(asked && { status: 'finished', finishedAt: now }), confirmBy: now, updatedAt: now }).where(eq(bookings.id, b.id)).returning()
    return r!
  })
  return async () => {
    if (b.status !== 'completed') await tryRelease(db, b.id, b.customerId, now)
    return reload(b.id)
  }
}

/**
 * Pays the provider the full paid amount of a `finished` booking (commission to KANDO in the same settle) and completes it;
 * a `stopped` booking whose customer agreed to the stated amount (`confirmBy` set, stop.ts) pays that amount and refunds the
 * rest (an agreed 0 refunds everything and ends `refunded`: no payout, no review requests). The share comes from the stored row, so the timer's retry pays the same split. Owner connection. Quiet when
 * already `completed`; 409 not-open for any other status (an open dispute: `disputed`, so never released here). Settle and the status change share
 * one transaction (settle runs in a savepoint): released_at, the commission row and `completed` commit together.
 *   crash / failure point                       | left behind                                | the retry (confirm or timer)
 *   settle refuses (409 / plain Error)          | nothing, booking finished                  | runs everything
 *   refund/transfer done, then a crash          | its ledger row (own connection)            | settle skips that step (no second call), then completes
 *   settle done, crash before `completed`       | refund/transfer rows; released_at rolled back | settle skips the moved money, writes commission + released_at, completes
 *   commit done, crash before the messages      | completed, messages lost (logged)          | nothing to do (quiet)
 * released_at set with `finished` cannot come from here; if another path left it, settle is skipped and the status follows.
 */
export async function releaseBooking(exec: Exec, bookingId: string, now: Date): Promise<void> {
  const b = await exec.transaction(async (o) => {
    const b = await lockRow(o, bookingId)
    if (b.status === 'completed' || (b.status === 'refunded' && b.stoppedAt)) return null
    const stopped = b.status === 'stopped' && b.confirmBy !== null && b.stopAmount !== null // the customer agreed to the stated amount (stop.ts)
    if (b.status !== 'finished' && !stopped) fail(409, { error: 'not-open' })
    // the provider's share in whole cents: everything paid, or for a stopped job the amount the customer agreed to
    const shareC = stopped ? toCents(Number(b.stopAmount)) : toCents(await paidAmount(o, b.id))
    if (!b.releasedAt) await settle(o, b.id, shareC / 100)
    // a stop agreed at 0 earned nothing: a full refund, not a completed job (no payout, no reviews)
    const refunded = stopped && shareC === 0
    await o.update(bookings).set({ status: refunded ? 'refunded' : 'completed', ...(!refunded && { completedAt: now }), updatedAt: now }).where(eq(bookings.id, b.id))
    return { ...b, refunded }
  })
  if (!b) return
  const owner = (await db.select({ id: providers.ownerId }).from(providers).where(eq(providers.id, b.providerId)))[0]?.id
  const variant: Record<string, string> = b.refunded ? { variant: 'stop-refund' } : b.status === 'stopped' ? { variant: 'stop' } : {}
  await notifyBookingEvent('payment-released', b.customerId, { bookingId: b.id, ...variant })
  if (owner) await notifyBookingEvent('payment-released', owner, { bookingId: b.id, role: 'provider', ...variant })
  if (b.refunded) return
  // the last moment to write one: the reveal (reviews.ts writeReview)
  const reviewBy = new Date(now.getTime() + REVIEW_VISIBLE_DAYS * DAY).toISOString()
  if (!b.parentBookingId) for (const u of [b.customerId, owner]) if (u) await notifyBookingEvent('review-requested', u, { bookingId: b.id, date: reviewBy })
}

/**
 * releaseBooking that never throws: true when the booking is now completed. A refusal or error is logged and, unless the
 * booking is merely frozen (open dispute or chargeback) or already moved on, flagged to staff once (`payment-unprocessed`,
 * one open flag per booking, note `release failed: <code or message>`); the booking stays `finished` and the next timer
 * run retries. A later successful release resolves that flag.
 */
export const tryRelease = (exec: Exec, bookingId: string, customerId: string, now: Date): Promise<boolean> =>
  attemptMoney('release', bookingId, customerId, now, () => releaseBooking(exec, bookingId, now))

/**
 * Runs one money step (a release or a cancellation's settle) and never throws: true when it went through. DISPUTE_OPEN and
 * not-open are only logged (frozen, or moved on);
 * anything else is logged and flagged to staff once (`payment-unprocessed`, note `release failed: <code or message>`, which
 * the timers order last), and a later success resolves that flag.
 */
export async function attemptMoney(what: string, bookingId: string, customerId: string, now: Date, run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run()
  } catch (e) {
    const code = e instanceof Response ? ((await e.json().catch(() => ({}))) as { error?: string }).error : undefined
    const why = code ?? describeError(e) // an error code or a cleaned error message, never request data or keys
    console.error(`[${what}] booking ${bookingId} not released: ${why}`)
    if (code === 'DISPUTE_OPEN' || code === 'not-open') return false
    await flagForStaff(db, { kind: 'payment-unprocessed', refId: bookingId, userId: customerId, note: `${RELEASE_FAILED}${why}`.slice(0, 500) }).catch((err) =>
      console.error(`[${what}] staff flag failed ${describeError(err)}`),
    )
    return false
  }
  // done: an open flag from an earlier failed attempt is settled too (staff see it closed by the system)
  await db
    .update(staffFlags)
    .set({ resolvedAt: now, resolvedBy: 'system' })
    .where(and(eq(staffFlags.kind, 'payment-unprocessed'), eq(staffFlags.refId, bookingId), isNull(staffFlags.resolvedAt), like(staffFlags.note, `${RELEASE_FAILED}%`)))
    .catch((err) => console.error(`[${what}] staff flag not resolved ${describeError(err)}`))
  // the money step has committed: the booking's group may now be final and due for its invoice (never throws)
  await issueInvoiceFor(bookingId, now)
  return true
}
