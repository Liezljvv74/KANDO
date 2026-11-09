import { FREE_CANCEL_HOURS, LATE_CANCEL_SHARE } from './endings'
import { HOUR } from './common'

// The one copy of the money rules: the server and the phone both import these, so a preview can never differ from what is stored.
// Amounts are euro numbers with at most 2 decimals; math runs in whole cents and rounds half up.

/** Integer cents. toPrecision(15) drops binary noise (19.99 * 100 = 1998.9999999999998). Throws on NaN, infinity, negatives and amounts too big to be exact. */
export function toCents(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER / 100) throw new RangeError(`invalid amount ${amount}`)
  return Math.round(Number((amount * 100).toPrecision(15)))
}

/** An amount rounded to whole cents (for sums of amounts); unlike toCents it accepts any finite number. */
export const roundMoney = (n: number): number => Math.round(n * 100) / 100

/** Commission on the amount actually paid out, rounded half up to cents. */
export function commissionFor(share: number, rate: number): number {
  if (!(rate >= 0 && rate <= 1)) throw new RangeError(`invalid commission rate ${rate}`)
  return Math.round(Number((toCents(share) * rate).toPrecision(15))) / 100
}

/** What a provider keeps of `amount` after commission (payment fees are inside the rate). */
export const youReceive = (amount: number, rate: number): number => roundMoney(amount - commissionFor(amount, rate))

/** Late means less than 24 hours to go; exactly 24 hours before the start is still free. */
export const isLate = (startAt: Date, now: Date): boolean => now.getTime() > startAt.getTime() - FREE_CANCEL_HOURS * HOUR

/** What a late customer cancellation costs: the late share of the amount in whole cents, half up. Never above the amount. */
export const lateCancelFee = (amount: number): number => {
  const cents = toCents(amount)
  return Math.min(cents, Math.round(cents * LATE_CANCEL_SHARE)) / 100
}

/** What the provider is paid when the customer cancels: nothing in time, the late fee otherwise. */
export const customerCancelShare = (amount: number, startAt: Date, now: Date): number => (isLate(startAt, now) ? lateCancelFee(amount) : 0)
