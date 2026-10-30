import { z } from 'zod'
import { AmountSchema, requiredText } from './common'

/** POST /bookings/:id/finish (provider): the material part of the price, 0 up to the booking amount (the server checks the upper bound). */
export const FinishInputSchema = z.object({ materialAmount: AmountSchema.optional() }).strict()
export type FinishInput = z.infer<typeof FinishInputSchema>

/** POST /bookings/:id/no-show/object (the side reported as not turning up, within 48 hours): becomes a dispute for staff. */
export const NoShowObjectionSchema = z.object({ description: requiredText(2000) }).strict()
export type NoShowObjection = z.infer<typeof NoShowObjectionSchema>

/** POST /bookings/:id/dispute (the customer, from "Finished" until the 7 days run out, or once asked "Was the job done?"). */
export const DisputeInputSchema = z.object({ description: requiredText(2000) }).strict()
export type DisputeInput = z.infer<typeof DisputeInputSchema>

/** POST /bookings/:id/stop/amount (the provider, after a stop): what was earned, 0 up to the booking amount (the server checks the upper bound). */
export const StopAmountInputSchema = z.object({ amount: AmountSchema, note: z.string().trim().max(1000).optional() }).strict()
export type StopAmountInput = z.infer<typeof StopAmountInputSchema>

/** POST /bookings/:id/stop/answer (the customer): agree pays the stated amount and refunds the rest; disagree goes to staff. */
export const StopAnswerSchema = z.object({ agree: z.boolean() }).strict()
export type StopAnswer = z.infer<typeof StopAnswerSchema>

export const DISPUTE_REASONS = ['problem', 'no-show-objection', 'no-response', 'stop-disagreed', 'chargeback'] as const

/** A dispute as the two parties see it (GET /bookings/:id/dispute). Who decided it is not shown. */
export const DisputeSchema = z.object({
  id: z.string(),
  bookingId: z.string(),
  /** The side that opened it; null = the system (no response, a chargeback). */
  openedBy: z.enum(['customer', 'provider']).nullable(),
  reason: z.enum(DISPUTE_REASONS),
  description: z.string(),
  createdAt: z.string(),
  /** Staff decide by then (14 working days). */
  decideBy: z.string(),
  decision: z.enum(['full-payout', 'partial', 'full-refund']).nullable(),
  /** What the provider is paid out of the booking by the decision. */
  providerShare: z.number().nullable(),
  decisionReason: z.string().nullable(),
  decidedAt: z.string().nullable(),
})
export type Dispute = z.infer<typeof DisputeSchema>
