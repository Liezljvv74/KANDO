import { z } from 'zod'
import { AmountSchema, requiredText } from './common'

/** POST /bookings/:id/finish (provider): the material part of the price, 0 up to the booking amount (the server checks the upper bound). */
export const FinishInputSchema = z.object({ materialAmount: AmountSchema.optional() }).strict()
export type FinishInput = z.infer<typeof FinishInputSchema>

/** POST /bookings/:id/no-show/object (the side reported as not turning up, within 48 hours): becomes a dispute for staff. */
export const NoShowObjectionSchema = z.object({ description: requiredText(2000) }).strict()
export type NoShowObjection = z.infer<typeof NoShowObjectionSchema>
