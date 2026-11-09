import { and, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { bookings, ledgerEntries, staffFlags } from '@kando/db'
import { MONEY_FLAGS } from '../bookings/job-state-lookup'
import type { Exec } from '../providers/eligibility'
import { COMMISSION_RATE, commissionFor, roundMoney, youReceive } from '@kando/contract'

export { youReceive }

/** The money box numbers of one booking; before payment (no stored rate) the current rate, so the line is "expected". */
export const bookingMoney = (amount: number, storedRate: number | string | null) => {
  const rate = storedRate === null ? COMMISSION_RATE : Number(storedRate)
  const commission = commissionFor(amount, rate)
  return { total: amount, commission, net: youReceive(amount, rate), rate }
}

/**
 * The provider's money strip (net amounts, spec 8b point 7). Owner connection: the ledger is staff only, so the caller checks
 * first that `providerId` is their own. Received this month: money released in the current calendar month (the device's month if given, else UTC; the net is the
 * transfer row). On its way: paid, not released, not on hold. On hold: a problem (dispute or no-show) or an open money flag.
 * Each booking, an additional task too, uses its own stored rate. ponytail: a stopped job is not counted until it is released.
 */
export async function providerMoney(owner: Exec, providerId: string, now: Date, month?: { from: Date; to: Date }): Promise<{ receivedThisMonth: number; onItsWay: number; onHold: number }> {
  // `month`: the caller's own calendar month (the device's time zone); without it the UTC month
  const from = month?.from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const to = month?.to ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const open = await owner
    .select({ id: bookings.id, amount: bookings.amount, rate: bookings.commissionRate, status: bookings.status, noShow: bookings.noShow })
    .from(bookings)
    .where(and(eq(bookings.providerId, providerId), isNotNull(bookings.paidAt), isNull(bookings.releasedAt), inArray(bookings.status, ['confirmed', 'finished', 'completed', 'disputed'])))
  const flagged = open.length
    ? new Set((await owner.select({ ref: staffFlags.refId }).from(staffFlags).where(and(inArray(staffFlags.kind, MONEY_FLAGS), isNull(staffFlags.resolvedAt), inArray(staffFlags.refId, open.map((b) => b.id))))).map((f) => f.ref))
    : new Set<string>()
  let onItsWay = 0
  let onHold = 0
  for (const b of open) {
    const net = bookingMoney(Number(b.amount), b.rate).net
    if (b.status === 'disputed' || b.noShow || flagged.has(b.id)) onHold += net
    else onItsWay += net
  }
  const [r] = await owner
    .select({ sum: sql<string>`coalesce(sum(${ledgerEntries.amount}), 0)::text` })
    .from(ledgerEntries)
    .innerJoin(bookings, eq(bookings.id, ledgerEntries.bookingId))
    .where(and(eq(ledgerEntries.providerId, providerId), eq(ledgerEntries.kind, 'transfer'), gte(bookings.releasedAt, from), lt(bookings.releasedAt, to)))
  return { receivedThisMonth: Number(r!.sum), onItsWay: roundMoney(onItsWay), onHold: roundMoney(onHold) }
}
