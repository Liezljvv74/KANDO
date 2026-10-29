import { z } from 'zod'

import { AmountSchema, CurrencySchema, requiredText } from './common'

/** Longest chat message in characters. */
export const MAX_MESSAGE_CHARS = 2000

/** POST /threads/:id/messages */
export const MessageInputSchema = z.object({ body: requiredText(MAX_MESSAGE_CHARS) })
export type MessageInput = z.infer<typeof MessageInputSchema>

/** Written by the server only (never by a party): what happened, with ids and amounts, no free text. */
export const CardSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('quote'), refId: z.string(), amount: AmountSchema, currency: CurrencySchema, version: z.number().int() }),
  z.object({ type: z.literal('acceptance'), refId: z.string(), amount: AmountSchema, currency: CurrencySchema }),
  z.object({ type: z.literal('additional-task'), refId: z.string(), amount: AmountSchema, currency: CurrencySchema }),
])
export type Card = z.infer<typeof CardSchema>

export const MESSAGE_KINDS = ['text', 'photo', 'card'] as const
export const MessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  mine: z.boolean(),
  kind: z.enum(MESSAGE_KINDS),
  body: z.string().nullable(),
  photoUrl: z.string().nullable(),
  card: CardSchema.nullable(),
  createdAt: z.string(),
})
export type Message = z.infer<typeof MessageSchema>

export const ThreadSchema = z.object({
  id: z.string(),
  requestId: z.string().nullable(),
  bookingId: z.string().nullable(),
  otherName: z.string(),
  /** The other person's account id: what a block names (the app shows only otherName). */
  otherUserId: z.string(),
  lastMessageAt: z.string().nullable(),
  blocked: z.boolean(),
})
export type Thread = z.infer<typeof ThreadSchema>

/** `after` is an opaque cursor: `<createdAt ISO>|<message id>`. */
export const MessagesQuerySchema = z.object({
  after: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    .refine((c) => !Number.isNaN(Date.parse(c.split('|')[0]!)), 'Invalid time')
    .optional(),
})
export type MessagesQuery = z.infer<typeof MessagesQuerySchema>

/** Longest report reason in characters. */
export const MAX_REPORT_CHARS = 500

/** POST /messages/:id/report: the reason is for staff only. */
export const ReportInputSchema = z.object({ reason: requiredText(MAX_REPORT_CHARS) })
export type ReportInput = z.infer<typeof ReportInputSchema>

/** POST /blocks */
export const BlockInputSchema = z.object({ userId: z.string().min(1).max(200) })
export type BlockInput = z.infer<typeof BlockInputSchema>

/** GET /blocks: the people the caller blocked, by the name the app shows for them. */
export const BlockedUserSchema = z.object({ userId: z.string(), name: z.string() })
export type BlockedUser = z.infer<typeof BlockedUserSchema>
