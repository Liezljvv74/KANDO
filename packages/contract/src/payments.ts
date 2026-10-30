import { z } from 'zod'

/** POST /bookings/:id/pay: the Stripe-hosted page where the customer pays the booking. */
export const PayLinkSchema = z.object({ url: z.string().url() })
export type PayLink = z.infer<typeof PayLinkSchema>

/** POST /payouts/setup: a fresh Stripe-hosted payout set-up link (same shape as the pay link). */
export const PayoutSetupSchema = PayLinkSchema
/** GET /payouts/status: whether the caller's payout set-up is complete. */
export const PayoutStatusSchema = z.object({ ready: z.boolean() })
export type PayoutStatus = z.infer<typeof PayoutStatusSchema>
