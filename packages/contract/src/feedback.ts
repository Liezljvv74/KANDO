import { z } from 'zod'

export const FEEDBACK_MESSAGE_MAX = 2000
export const FEEDBACK_EMAIL_MAX = 254

/** POST /feedback: the sender's email (so the owner can answer) and the comment. Emailed, never stored. */
export const FeedbackInputSchema = z.object({
  email: z.string().trim().max(FEEDBACK_EMAIL_MAX).pipe(z.email()),
  message: z.string().trim().min(1).max(FEEDBACK_MESSAGE_MAX),
})
export type FeedbackInput = z.infer<typeof FeedbackInputSchema>
