import { z } from 'zod'

import { LangSchema, requiredText } from './common'

const optionalText = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullish()

/** The person's private address: only the postcode is required (the provider draft's postcode is prefilled from it; nothing else reads it today); blank street and city are stored as null (country defaults to 'DE'; country-ready for later markets). */
export const AddressSchema = z.object({
  postcode: requiredText(16),
  street: optionalText(120),
  city: optionalText(80),
  country: z.string().length(2),
})
export type Address = z.infer<typeof AddressSchema>

/** An in-app message for the owner; the app only marks it seen or dismissed. */
export const NOTIFICATION_KINDS = ['profile-live', 'request-received', 'quote-received', 'booking-proposed', 'booking-accepted', 'booking-declined', 'booking-expired', 'payment-reminder', 'quote-expiring', 'request-expired', 'requests-ignored', 'pending-slot-requested', 'message-received', 'booking-paid', 'payment-received', 'payment-late-refunded', 'payout-setup-complete', 'customers-waiting', 'provider-available', 'refund-issued', 'job-finished', 'confirm-reminder', 'payment-released', 'was-job-done', 'booking-cancelled', 'no-show-reported', 'dispute-opened', 'dispute-decided', 'job-stopped', 'stop-amount-stated', 'additional-task-requested', 'review-requested', 'review-visible', 'provider-warning'] as const
export const NotificationSchema = z.object({
  id: z.string(),
  kind: z.enum(NOTIFICATION_KINDS),
  /** profile-live carries the profile link; message-received a link and the thread id; the booking kinds carry ids only (none for requests-ignored). */
  payload: z.union([z.object({ url: z.string().url(), threadId: z.string().optional() }), z.object({ requestId: z.string().optional(), bookingId: z.string().optional(), quoteId: z.string().optional(), /** customers-waiting: how many, never who */ count: z.number().int().nonnegative().optional() })]),
  createdAt: z.string(),
  seenAt: z.string().nullable(),
  dismissedAt: z.string().nullable(),
})
export type Notification = z.infer<typeof NotificationSchema>

/** PATCH /notifications/[id]. */
export const NotificationPatchSchema = z.object({ seen: z.literal(true).optional(), dismissed: z.literal(true).optional() })

export const MeSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  language: LangSchema.nullish(),
  isProvider: z.boolean(),
  /** The person's picture (their profile photo), if any. */
  photoUrl: z.string().nullable(),
  address: AddressSchema.nullable(),
  /** Tolerant: a kind or payload this version does not know (a newer server) is dropped, the rest of /me still parses. */
  notifications: z.array(z.unknown()).transform((items) => items.flatMap((i) => { const r = NotificationSchema.safeParse(i); return r.success ? [r.data] : [] })),
})
export type Me = z.infer<typeof MeSchema>

/** POST /push-tokens (DELETE takes just the token): this device's Expo push token. Never part of any DTO. */
export const PushTokenInputSchema = z.object({
  token: z.string().max(200).regex(/^ExponentPushToken\[[^\]]+\]$/),
  platform: z.enum(['ios', 'android']),
})
export type PushTokenInput = z.infer<typeof PushTokenInputSchema>
export const PushTokenDeleteSchema = PushTokenInputSchema.pick({ token: true })

/** GET /me/push; PATCH takes any part of it. Chat messages and reminders, both on by default. */
export const PushSettingsSchema = z.object({ chat: z.boolean(), reminders: z.boolean() })
export type PushSettings = z.infer<typeof PushSettingsSchema>
export const PushSettingsPatchSchema = PushSettingsSchema.partial()

/** DELETE /me: the person types their own email to confirm. */
export const DeleteMeSchema = z.object({ confirmEmail: z.string().max(320) })

/** PATCH /me: names, language of emails and private address; all optional (address null clears it). */
export const MePatchSchema = z
  .object({
    firstName: requiredText(60),
    lastName: requiredText(60),
    language: LangSchema,
    address: AddressSchema.nullable(),
  })
  .partial()
export type MePatch = z.infer<typeof MePatchSchema>
