import { z } from 'zod'
import { AmountSchema } from './common'

/** POST /bookings/:id/finish (provider): the material part of the price, 0 up to the booking amount (the server checks the upper bound). */
export const FinishInputSchema = z.object({ materialAmount: AmountSchema.optional() }).strict()
export type FinishInput = z.infer<typeof FinishInputSchema>
