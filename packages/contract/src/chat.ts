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
  lastMessageAt: z.string().nullable(),
  blocked: z.boolean(),
})
export type Thread = z.infer<typeof ThreadSchema>

/** `after` is an opaque cursor: `<createdAt ISO>|<message id>`. */
export const MessagesQuerySchema = z.object({
  after: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\|[0-9a-f-]{36}$/i)
    .optional(),
})
export type MessagesQuery = z.infer<typeof MessagesQuerySchema>
