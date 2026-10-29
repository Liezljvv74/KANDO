/** PLACEHOLDER: the owner has not decided the rate (spec 4); README reminder. Copied to bookings.commission_rate at payment. */
export const COMMISSION_RATE = 0.12

/** Real money needs a reviewed code change after the lawyer clears spec section 9: only Stripe test keys are accepted. */
export const LIVE_PAYMENTS_ALLOWED = false

/** At most one "customers are waiting" notice to an unready provider per this many hours (my call). */
export const CUSTOMERS_WAITING_NOTICE_HOURS = 24

/**
 * The longest Stripe lets funds sit in a balance before they must be paid out, for a business outside the US and Thailand.
 * Source (read 29 Oct 2026), https://docs.stripe.com/connect/manual-payouts : "If you set the value of
 * payments.payouts.schedule.interval to `manual`, we hold funds in the account holder's balance until you specify
 * otherwise. You must pay out the funds within the time period specified below, based on the business's country:
 * Thailand 10 days, United States 2 years, All other countries 90 days." KANDO keeps a booking's money in its own
 * platform balance (separate charges and transfers), so that balance must be on manual payouts (or the money would go
 * to KANDO's bank account), and the German platform gets 90 days. The separate-charges-and-transfers page states no
 * limit of its own. The whole hold (payment, the job, 7 days after "Finished", a dispute) must fit inside this.
 */
export const MAX_HOLD_DAYS = 90

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
