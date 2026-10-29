import { eq, inArray } from 'drizzle-orm'
import { bookings, db, ledgerEntries, providers } from '@kando/db'
import { isUuid } from '../admin/common'
import type { Exec } from '../providers/eligibility'
import { fail } from '../providers/http'
import { gateway } from './gateway'
import { addLedger, paidAmount } from './ledger'
import { commissionFor, toCents } from './rules'

/**
 * Pays out a paid booking: `providerShare` to the provider minus KANDO's commission (at the booking's stored rate), the
 * rest of what was paid back to the customer. Owner connection only (released_at is staff only: the update below fails
 * for app_user before any money moves). The caller sets the booking status (plan 2d). The commission needs no gateway
 * call: it is the part of the charge that stays on the platform; its ledger row records it.
 * 404 unknown booking; 409 NOT_PAID; 409 ALREADY_SETTLED once released_at is set; 400 share not 0..paid in whole cents;
 * 409 NO_PAYOUT_ACCOUNT when a transfer is due and the provider has no payout account; 409 SETTLEMENT_MISMATCH when an
 * earlier, partly done run moved a different split.
 *
 * Crash safety. The booking row is locked FOR UPDATE for the whole run (a second settle waits, then sees released_at).
 * Each money movement is written to the ledger on its own connection (`db`) as soon as the gateway confirms it, so it
 * survives a rollback; a retry skips every step whose row exists, and the same idempotency key goes to the gateway.
 * released_at and the commission row commit together at the end. "Settled" means released_at is set, not "has rows".
 *   crash / failure point                          | left behind                    | the retry (a timer)
 *   before or during the refund call               | nothing                        | runs everything
 *   refund done, crash before its ledger row       | nothing in the ledger          | refund again, same key: Stripe replays it (keys live >= 24 h; see ponytail)
 *   refund row written, transfer fails             | refund row, released_at null   | skips the refund, transfers, commission, release
 *   transfer done, crash before its ledger row     | refund row                     | transfer again, same key: replayed
 *   both rows written, commit fails                | refund + transfer rows         | writes the commission row and released_at only
 *   the caller's transaction rolls back afterwards | refund + transfer rows         | as above
 * ponytail: the "crash between gateway success and ledger row" window relies on the gateway's idempotency key; a retry
 * more than 24 h later could repeat that one movement. Upgrade: look up the refund/transfer by key metadata before calling.
 * ponytail: holds a second pool connection while the first holds the lock; settle bookings one at a time (timer loop),
 * a parallel fan-out needs pool headroom.
 */
export async function settle(exec: Exec, bookingId: string, providerShare: number): Promise<{ refunded: number; transferred: number; commission: number }> {
  if (!isUuid(bookingId)) return fail(404, { error: 'Not found' })
  return exec.transaction(async (tx) => {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for('update')
    if (!b) return fail(404, { error: 'Not found' })
    if (!b.paidAt) fail(409, { error: 'NOT_PAID' })
    if (b.releasedAt) fail(409, { error: 'ALREADY_SETTLED' })
    if (!b.paymentRef || b.commissionRate === null) throw new Error(`paid booking ${b.id} lacks its payment ref or commission rate`)
    const key = { refund: `refund:${b.id}`, transfer: `transfer:${b.id}`, commission: `commission:${b.id}` }
    // what an earlier, interrupted run of this settlement already recorded (cents by key)
    const done = new Map(
      (await tx.select({ key: ledgerEntries.idempotencyKey, amount: ledgerEntries.amount }).from(ledgerEntries).where(inArray(ledgerEntries.idempotencyKey, Object.values(key)))).map((r) => [r.key, toCents(Number(r.amount))]),
    )
    const paidC = toCents(await paidAmount(tx, b.id)) + (done.get(key.refund) ?? 0) // this settlement's own refund does not count against it
    if (!(Number.isFinite(providerShare) && providerShare >= 0 && providerShare <= paidC / 100) || toCents(providerShare) / 100 !== providerShare) fail(400, { error: 'INVALID_SHARE' })
    const shareC = toCents(providerShare)
    const commissionC = toCents(commissionFor(providerShare, Number(b.commissionRate)))
    const plan = { [key.refund]: paidC - shareC, [key.transfer]: shareC - commissionC, [key.commission]: commissionC }
    if ([...done].some(([k, cents]) => plan[k] !== cents)) fail(409, { error: 'SETTLEMENT_MISMATCH' })
    const due = (k: string) => plan[k]! > 0 && !done.has(k)

    let accountId: string | null = null
    if (due(key.transfer)) {
      accountId = (await tx.select({ id: providers.stripeAccountId }).from(providers).where(eq(providers.id, b.providerId)))[0]?.id ?? null
      if (!accountId) fail(409, { error: 'NO_PAYOUT_ACCOUNT' })
    }
    // Uncommitted until the end; on app_user this fails (staff-only column) before any money moves.
    await tx.update(bookings).set({ releasedAt: new Date() }).where(eq(bookings.id, b.id))
    const row = { bookingId: b.id, providerId: b.providerId, currency: b.currency }
    if (due(key.refund)) {
      const { refundId } = await gateway().refund({ paymentRef: b.paymentRef, amountCents: plan[key.refund]!, idempotencyKey: key.refund })
      await addLedger(db, { ...row, kind: 'refund', amount: plan[key.refund]! / 100, gatewayRef: refundId, idempotencyKey: key.refund })
    }
    if (due(key.transfer)) {
      const { transferId } = await gateway().transfer({ accountId: accountId!, amountCents: plan[key.transfer]!, currency: b.currency, paymentRef: b.paymentRef, bookingId: b.id, idempotencyKey: key.transfer })
      await addLedger(db, { ...row, kind: 'transfer', amount: plan[key.transfer]! / 100, gatewayRef: transferId, idempotencyKey: key.transfer })
    }
    if (due(key.commission)) await addLedger(tx, { ...row, kind: 'commission', amount: commissionC / 100, gatewayRef: b.paymentRef, idempotencyKey: key.commission })
    return { refunded: plan[key.refund]! / 100, transferred: plan[key.transfer]! / 100, commission: commissionC / 100 }
  })
}
