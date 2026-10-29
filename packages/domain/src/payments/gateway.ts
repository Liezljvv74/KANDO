import { LIVE_PAYMENTS_ALLOWED, paymentsEnabled } from './rules'
import { stripeClient, stripeGateway } from './stripe-gateway'

/** Everything KANDO asks of the payment provider. Amounts are integer cents; idempotency keys make retries safe. */
export interface PaymentsGateway {
  createAccount(i: { email: string; country: string }): Promise<{ accountId: string }>
  onboardingLink(i: { accountId: string; returnUrl: string; refreshUrl: string }): Promise<{ url: string }>
  accountReady(accountId: string): Promise<boolean>
  createCheckout(i: {
    bookingId: string
    amountCents: number
    currency: string
    description: string
    successUrl: string
    cancelUrl: string
    expiresAt: Date
    idempotencyKey: string
  }): Promise<{ sessionId: string; url: string }>
  transfer(i: { accountId: string; amountCents: number; currency: string; paymentRef: string; bookingId: string; idempotencyKey: string }): Promise<{ transferId: string }>
  refund(i: { paymentRef: string; amountCents: number; idempotencyKey: string }): Promise<{ refundId: string }>
  /** Throws on a bad signature. */
  verifyEvent(rawBody: string, signature: string): GatewayEvent
}

export type GatewayEvent =
  | { id: string; type: 'checkout-paid'; bookingId: string; sessionId: string; paymentRef: string; amountCents: number; currency: string }
  | { id: string; type: 'account-updated'; accountId: string }
  | { id: string; type: 'charge-disputed'; paymentRef: string }
  | { id: string; type: 'other' }

function fromEnv(): PaymentsGateway {
  // Vercel uses STRIPE_SECRET_KEY; Stripe_Secret_Key is the owner's local .env spelling. Never put the key in a message.
  const key = process.env.STRIPE_SECRET_KEY || process.env.Stripe_Secret_Key
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  if (!/^(sk|rk)_test_/.test(key) && !LIVE_PAYMENTS_ALLOWED) throw new Error('Only Stripe test keys are accepted: live payments are not allowed')
  return stripeGateway(stripeClient(key))
}

let current: PaymentsGateway | undefined
/** The Stripe gateway, created on first use; refuses while PAYMENTS_ENABLED is off (also for a test gateway). */
export const gateway = (): PaymentsGateway => {
  if (!paymentsEnabled()) throw new Error('Payments are off (PAYMENTS_ENABLED is not "true")')
  return (current ??= fromEnv())
}
export const setGatewayForTests = (impl: PaymentsGateway | undefined) => {
  current = impl
}
