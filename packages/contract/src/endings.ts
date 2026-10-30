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

/** POST /bookings/:id/additional-task (either side, on a paid or finished booking): what the extra work is; the provider then quotes it. */
export const AdditionalTaskInputSchema = z.object({ description: requiredText(2000) }).strict()
export type AdditionalTaskInput = z.infer<typeof AdditionalTaskInputSchema>

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

/** PATCH /reviews/:id (its author, for 14 days): 1 to 5 whole stars and an optional text. */
export const ReviewInputSchema = z.object({ stars: z.number().int().min(1).max(5), text: z.string().trim().max(2000).optional() }).strict()
export type ReviewInput = z.infer<typeof ReviewInputSchema>
/** POST /reviews (a party of a completed booking, once, within 7 days of completion). */
export const WriteReviewSchema = ReviewInputSchema.extend({ bookingId: z.string().uuid() }).strict()

/** A review as its author and (once shown) the other party see it (GET /reviews). */
export const ReviewSchema = z.object({
  id: z.string(),
  bookingId: z.string(),
  /** Written by the caller. */
  mine: z.boolean(),
  authorRole: z.enum(['customer', 'provider']),
  stars: z.number().int(),
  text: z.string().nullable(),
  createdAt: z.string(),
  /** When the other side sees it: once both are in, or 7 days after completion. */
  visibleAt: z.string().nullable(),
  /** The caller's own review can be edited until then; null on the other side's. */
  editableUntil: z.string().nullable(),
  /** Hidden by staff (only ever true on the caller's own review). */
  hidden: z.boolean(),
})
export type Review = z.infer<typeof ReviewSchema>

/** Average stars (one decimal) and the number of visible reviews; null when there are none. */
export const RatingSchema = z.object({ average: z.number(), count: z.number().int() })
export type Rating = z.infer<typeof RatingSchema>

/** A staff member's written reason: sent to both sides (decision, refund) or kept with the review (hiding). */
const staffReason = z.string().trim().min(10).max(2000)

/**
 * POST /api/admin/disputes/:id/decide (Administrator). `providerShare` only with `partial` (more than 0; the server checks
 * that it is below the paid amount and in whole cents); a full payout pays everything, a full refund nothing.
 */
export const DisputeDecisionSchema = z
  .object({ decision: z.enum(['full-payout', 'partial', 'full-refund']), providerShare: AmountSchema.optional(), reason: staffReason })
  .strict()
  .refine((d) => (d.decision === 'partial' ? d.providerShare !== undefined && d.providerShare > 0 : d.providerShare === undefined), { path: ['providerShare'], message: 'A share only with partial, and more than 0' })
export type DisputeDecision = z.infer<typeof DisputeDecisionSchema>

/** POST /api/admin/bookings/:id/refund (Administrator): settles an unsettled paid booking; the provider keeps `providerShare`, the rest goes back. */
export const StaffRefundSchema = z.object({ providerShare: AmountSchema, reason: staffReason }).strict()
export type StaffRefund = z.infer<typeof StaffRefundSchema>

/** POST /api/admin/reviews/:id/hide (Administrator): hide a review that breaks the rules, or show it again. */
export const ReviewHideSchema = z.object({ hidden: z.boolean(), reason: staffReason }).strict()
export type ReviewHide = z.infer<typeof ReviewHideSchema>
