// COMMISSION_RATE (15% including Stripe's payment fees, provisional, to be reviewed after research; copied to bookings.commission_rate at payment)
// lives in @kando/contract so the phone shows the same rate; this is still the one place the server reads it from.
// Shim: toCents and commissionFor are implemented in @kando/contract (money.ts); new code should import them from there.
export { COMMISSION_RATE, commissionFor, toCents } from '@kando/contract'

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

/**
 * The smallest amount Stripe charges, in cents, by currency. Stripe documents a minimum charge amount per currency
 * (https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts): EUR 0.50.
 */
export const MIN_CHARGE_CENTS: Record<string, number> = { EUR: 50 }
export const belowMinCharge = (cents: number, currency: string): boolean => cents < (MIN_CHARGE_CENTS[currency.toUpperCase()] ?? 0)

/** A payment that arrives up to this many minutes after payBy still confirms the booking (in-flight at the deadline), if the booking is still awaiting payment and the time still free. */
export const PAY_GRACE_MINUTES = 10

const CHECKOUT_MIN_MS = 31 * 60_000 // Stripe: at least 30 minutes; one minute of margin for the time to the call
const CHECKOUT_STEP_MS = 23 * 3_600_000 // under Stripe's 24-hour maximum by more than the margin

/**
 * When a Checkout session for a booking expires: payBy, or payBy minus a whole number of 23-hour steps, whichever is the
 * first at least 31 minutes from now. So it is 31 min to 23 h 31 min ahead (Stripe allows 30 min to 24 h), never after
 * payBy, and the same for every call within one step: a retry after a crash sends the same parameters under the same
 * idempotency key. Null when payBy is less than 31 minutes away: the booking cannot be paid any more (PAY_WINDOW_TOO_SHORT).
 */
export function checkoutExpiry(payBy: Date, now: Date): Date | null {
  const room = payBy.getTime() - now.getTime() - CHECKOUT_MIN_MS
  if (room < 0) return null
  return new Date(payBy.getTime() - Math.floor(room / CHECKOUT_STEP_MS) * CHECKOUT_STEP_MS)
}

export const paymentsEnabled = (): boolean => process.env.PAYMENTS_ENABLED === 'true'

export type TransactFacts = { payoutsReadyAt: Date | null; invoiceConsentAt: Date | null; legalStatus: string | null; vatId: string | null; taxNumber: string | null }

export type QuoteStep = 'payout' | 'consent' | 'taxId'

/**
 * What a provider still needs before quoting, in order. Empty with payments off. With payments on: payout set-up complete,
 * agreed that the platform issues invoices in their name, and (Kleinunternehmer or business) a VAT id or tax number for them.
 */
export const quoteSteps = (p: TransactFacts): QuoteStep[] => {
  if (!paymentsEnabled()) return []
  const steps: QuoteStep[] = []
  if (p.payoutsReadyAt === null) steps.push('payout')
  if (p.invoiceConsentAt === null) steps.push('consent')
  if ((p.legalStatus === 'kleinunternehmer' || p.legalStatus === 'business') && !(p.vatId?.trim() || p.taxNumber?.trim())) steps.push('taxId')
  return steps
}

export const canTransact = (p: TransactFacts): boolean => quoteSteps(p).length === 0

/** What bookings.checkout_ref holds (staff-only column, owner connection): the open Checkout session, so a second tap reuses it. */
export type CheckoutRef = { sessionId: string; url: string; expiresAt: string; /** when the session was made; refs from before this field have none */ startedAt?: string }
export const readRef = (v: string | null): CheckoutRef | null => {
  try {
    return v ? (JSON.parse(v) as CheckoutRef) : null
  } catch {
    return null // an unreadable ref only means a new session
  }
}
