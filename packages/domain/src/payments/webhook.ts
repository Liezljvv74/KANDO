import { and, eq } from 'drizzle-orm'
import { bookings, db, ledgerEntries, providers, stripeEvents, users, type Tx } from '@kando/db'
import { lockProviderSlots, slotIsHeld } from '../bookings/busy'
import { parentBlocksPayment } from '../bookings/additional'
import { openSystemDispute } from '../bookings/disputes'
import { notifyBookingEvent } from '../bookings/notify'
import { flagForStaff } from '../chat/flags'
import { describeError } from '../log-error'
import { gateway, type GatewayEvent } from './gateway'
import { addLedger } from './ledger'
import { refreshAccount } from './onboarding'
import { COMMISSION_RATE, PAY_GRACE_MINUTES, toCents } from './rules'

type Paid = Extract<GatewayEvent, { type: 'checkout-paid' }>
type After = (() => Promise<void>)[]

/**
 * Handles one verified gateway event, once: in ONE owner-connection transaction the event id is recorded first (a
 * redelivered event finds it and stops), then the event is acted on. Messages go out only after the commit.
 *
 * checkout-paid: takes the provider's slot lock, then the booking row (the order accepting uses). A booking still
 * awaiting payment, its deadline not more than PAY_GRACE_MINUTES past, the amount and currency as charged and its time
 * still free (a lapsed hold can overlap a newer one until the sweep) becomes `confirmed` with paid_at, payment_ref and
 * commission_rate = COMMISSION_RATE, and its `charge` row is written in the same transaction. Every other paid event
 * (expired, withdrawn, declined, deleted with an account, already paid by another payment, time taken) gets its
 * `charge` row and a FULL refund with its `refund` row; the customer is told when they still exist. A second event for
 * the payment the booking already holds changes nothing.
 *
 * The refund obligation is never lost: the refund call runs INSIDE the transaction, before the commit that marks the
 * event processed. Crash / failure table (Stripe redelivers an event until it gets a 2xx, for up to three days):
 *   point of failure                              | left behind                 | what happens next
 *   before the commit, no refund due              | nothing (rolled back)       | redelivery confirms
 *   refund call fails                             | nothing (rolled back), 500  | redelivery refunds (same key)
 *   refund done, crash or commit failure          | nothing (rolled back)       | redelivery: same key, the gateway replays the refund (or finds it by its metadata key after 24 h): no second refund; rows written
 *   commit done, crash before the messages        | all rows, event recorded    | messages lost (logged), money and status right
 * ponytail: the provider lock and the row are held during the refund call (15 s timeout, two retries); refunds are rare.
 */
export async function handleGatewayEvent(e: GatewayEvent, now = new Date()): Promise<void> {
  if (e.type === 'other') return
  if (e.type === 'account-updated') return refreshAccount(db, e.accountId) // reads the state from the gateway: safe to repeat, no event row needed
  const after: After = []
  await db.transaction(async (tx) => {
    const fresh = await tx.insert(stripeEvents).values({ id: e.id, type: e.type }).onConflictDoNothing().returning({ id: stripeEvents.id })
    if (!fresh.length) return // processed before (a concurrent delivery waits on the key, then lands here)
    if (e.type === 'checkout-paid') return paid(tx, e, now, after)
    // a dispute or a failed refund: staff act by hand (one open flag per booking and kind)
    const bookingId = e.type === 'refund-failed' && e.bookingId ? e.bookingId : await bookingOfPayment(tx, e.paymentRef)
    // a payment or refund of another environment sharing this Stripe account (its booking is not ours, nor in the ledger): not ours to flag
    if (!bookingId || !(await bookingKnown(tx, bookingId))) return console.warn(`[payments] ${e.type} ignored: not a booking of this environment`)
    const customerId = bookingId ? (await tx.select({ c: bookings.customerId }).from(bookings).where(eq(bookings.id, bookingId)))[0]?.c : undefined
    const note = e.type === 'charge-disputed' ? `dispute on payment ${e.paymentRef}` : `refund ${e.refundId} of payment ${e.paymentRef} failed`
    await flagForStaff(tx, { kind: e.type === 'charge-disputed' ? 'chargeback' : 'refund-failed', refId: bookingId ?? e.paymentRef, ...(customerId && { userId: customerId }), note })
    // a chargeback on money not yet released: also a system dispute, so the job is frozen and in the staff queue (once: a
    // second event finds the dispute; released or ended bookings keep the flag only)
    if (e.type === 'charge-disputed' && bookingId) await openSystemDispute(tx, bookingId, 'chargeback', now, { afterCommit: (fn) => after.push(fn) })
  })
  for (const fn of after) await fn().catch((err) => console.error(`[payments] message after ${e.type} failed ${describeError(err)}`))
}

/** A booking of this database, or one that was deleted with an account (its ledger rows stay). */
async function bookingKnown(tx: Tx, bookingId: string): Promise<boolean> {
  if ((await tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, bookingId)).limit(1)).length) return true
  return (await tx.select({ id: ledgerEntries.id }).from(ledgerEntries).where(eq(ledgerEntries.bookingId, bookingId)).limit(1)).length > 0
}

/**
 * The Stripe test account is shared with other deployed sites whose payments reach this webhook too. A paid event whose booking is
 * not here, has no ledger rows, and whose customer and provider are both unknown belongs to another environment: it is ignored
 * (no refund, no ledger rows). If only the customer's or the provider's account was deleted, the other still exists and the
 * payment is refunded as before. ponytail: a booking whose customer AND provider were both deleted before it was paid is ignored too.
 */
async function foreignPayment(tx: Tx, e: Paid): Promise<boolean> {
  if (await bookingKnown(tx, e.bookingId)) return false
  if ((await tx.select({ id: users.id }).from(users).where(eq(users.id, e.customerId)).limit(1)).length) return false
  return !(await tx.select({ id: providers.id }).from(providers).where(eq(providers.id, e.providerId)).limit(1)).length
}

/** The booking a payment belongs to, from its charge row (kept even when the booking was deleted). */
async function bookingOfPayment(tx: Tx, paymentRef: string): Promise<string | undefined> {
  return (await tx.select({ id: ledgerEntries.bookingId }).from(ledgerEntries).where(and(eq(ledgerEntries.kind, 'charge'), eq(ledgerEntries.gatewayRef, paymentRef))))[0]?.id
}

async function paid(tx: Tx, e: Paid, now: Date, after: After): Promise<void> {
  await lockProviderSlots(tx, e.providerId)
  const [b] = await tx.select().from(bookings).where(eq(bookings.id, e.bookingId)).for('update')
  if (!b && (await foreignPayment(tx, e))) return console.warn('[payments] checkout-paid ignored: not a booking of this environment')
  if (b?.paymentRef === e.paymentRef) return // this payment is already the booking's (another event for it)
  const charge = { bookingId: e.bookingId, providerId: b?.providerId ?? e.providerId, amount: e.amountCents / 100, currency: e.currency }
  const confirmable =
    b &&
    b.providerId === e.providerId &&
    b.status === 'awaiting-payment' &&
    b.payBy &&
    now.getTime() <= b.payBy.getTime() + PAY_GRACE_MINUTES * 60_000 &&
    toCents(Number(b.amount)) === e.amountCents &&
    b.currency === e.currency &&
    // an additional task has its parent's time (no slot check) and is refunded once the parent has a reported no-show or has ended
    (b.parentBookingId ? !(await parentBlocksPayment(tx, b)) : !(await slotIsHeld(tx, b.providerId, b.startAt, b.durationMin, b.onSite, now, b.id))) // owner connection sees every booking; other slot writers wait on our lock

  if (confirmable) {
    // booking first, then its charge row: both or neither
    await tx.update(bookings).set({ status: 'confirmed', paidAt: now, paymentRef: e.paymentRef, commissionRate: COMMISSION_RATE.toFixed(4), updatedAt: now }).where(eq(bookings.id, b.id))
    await addLedger(tx, { ...charge, kind: 'charge', gatewayRef: e.paymentRef, idempotencyKey: `charge:${e.paymentRef}` })
    const owner = (await tx.select({ id: providers.ownerId }).from(providers).where(eq(providers.id, b.providerId)))[0]?.id
    const date = b.startAt.toISOString()
    after.push(() => notifyBookingEvent('payment-received', b.customerId, { bookingId: b.id, date }))
    if (owner) after.push(() => notifyBookingEvent('booking-paid', owner, { bookingId: b.id, date }))
    return
  }
  // Not usable: record the money and give all of it back. Key per payment: two late payments of one booking are two refunds.
  const key = `refund:late:${e.bookingId}:${e.paymentRef}`
  await addLedger(tx, { ...charge, kind: 'charge', gatewayRef: e.paymentRef, idempotencyKey: `charge:${e.paymentRef}` })
  const { refundId } = await gateway().refund({ paymentRef: e.paymentRef, amountCents: e.amountCents, bookingId: e.bookingId, idempotencyKey: key })
  await addLedger(tx, { ...charge, kind: 'refund', gatewayRef: refundId, idempotencyKey: key })
  const customer = b?.customerId ?? e.customerId // notifyBookingEvent skips a deleted account
  after.push(() => notifyBookingEvent('payment-late-refunded', customer, b ? { bookingId: b.id } : {}))
}
