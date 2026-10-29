import { z } from 'zod'

/** POST /bookings/:id/pay: the Stripe-hosted page where the customer pays the booking. */
export const PayLinkSchema = z.object({ url: z.string().url() })
export type PayLink = z.infer<typeof PayLinkSchema>
