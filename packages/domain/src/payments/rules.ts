/** PLACEHOLDER: the owner has not decided the rate (spec 4); README reminder. Copied to bookings.commission_rate at payment. */
export const COMMISSION_RATE = 0.12

/** Real money needs a reviewed code change after the lawyer clears spec section 9: only Stripe test keys are accepted. */
export const LIVE_PAYMENTS_ALLOWED = false

/** At most one "customers are waiting" notice to an unready provider per this many hours (my call). */
export const CUSTOMERS_WAITING_NOTICE_HOURS = 24

/**
 * A conservative bound on how long a booking's money is held, in days. Stripe states no limit for funds held in the
 * platform's own balance (separate charges and transfers; https://docs.stripe.com/connect/separate-charges-and-transfers
 * and https://docs.stripe.com/connect/charges, read 29 Oct 2026). The bound is borrowed from the manual-payouts table for
 * a connected account's balance, https://docs.stripe.com/connect/manual-payouts : "You must pay out the funds within the
 * time period specified below, based on the business's country: Thailand 10 days, United States 2 years, All other
 * countries 90 days."
 */
export const MAX_HOLD_DAYS = 90

/**
 * A booking whose start is more than this many days away cannot be paid (TOO_FAR_AHEAD; controller's ruling). 60 days +
 * the job + 7 days after "Finished" + slack stay within MAX_HOLD_DAYS. Card disputes can arrive up to about 120 days after
 * the charge, so no hold covers them: a dispute after the payout is a platform loss handled manually.
 */
export const MAX_PAY_AHEAD_DAYS = 60

export const paymentsEnabled = (): boolean => process.env.PAYMENTS_ENABLED === 'true'

/** Integer cents for the gateway. toPrecision(15) drops binary noise (19.99 * 100 = 1998.9999999999998). */
export function toCents(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER / 100) throw new RangeError(`invalid amount ${amount}`)
  return Math.round(Number((amount * 100).toPrecision(15)))
}

/** Commission on the amount actually paid out, rounded half up to cents. */
export function commissionFor(share: number, rate: number): number {
  if (!(rate >= 0 && rate <= 1)) throw new RangeError(`invalid commission rate ${rate}`)
  return Math.round(Number((toCents(share) * rate).toPrecision(15))) / 100
}

/** With payments off every provider can transact; with payments on only one whose payout set-up is complete. */
export const canTransact = (p: { payoutsReadyAt: Date | null }): boolean => !paymentsEnabled() || p.payoutsReadyAt !== null
