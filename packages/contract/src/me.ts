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

/** A calendar day before today (UTC), not more than 120 years back. */
export const BirthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`)
    const now = Date.now()
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && d.getTime() < now - (now % 86_400_000) && d.getTime() > now - 120 * 365.25 * 86_400_000
  })

/** An in-app message for the owner; the app only marks it seen or dismissed. */
export const NOTIFICATION_KINDS = ['profile-live', 'request-received', 'quote-received', 'booking-accepted', 'booking-expired', 'payment-reminder', 'quote-expiring', 'request-expired', 'requests-ignored', 'message-received', 'booking-paid', 'payment-received', 'payment-late-refunded', 'payout-setup-complete', 'customers-waiting', 'provider-available', 'refund-issued', 'job-finished', 'confirm-reminder', 'payment-released', 'was-job-done', 'booking-cancelled', 'no-show-reported', 'dispute-opened', 'dispute-decided', 'job-stopped', 'stop-amount-stated', 'additional-task-requested', 'review-requested', 'review-visible', 'provider-warning', 'invoice-ready', 'commission-invoice-ready', 'request-withdrawn', 'request-declined', 'request-reopened', 'request-updated', 'time-proposed', 'time-to-confirm', 'quote-confirmed'] as const
/** Kinds about a request whose booking (if named) has ended: the push and the in-app notice open the request, not the booking. */
export const REQUEST_SCREEN_KINDS: readonly (typeof NOTIFICATION_KINDS)[number][] = ['request-withdrawn', 'request-declined', 'request-reopened']
/** The job a notice is about, looked up when the notice is read (never stored): the root request's id, its number and title, and the other party's public name. Additive: `requestId` is the request whose job page shows the notice's booking or request (an additional task's own request). */
export const NoticeJobSchema = z.object({ id: z.string(), number: z.number().int(), title: z.string(), otherParty: z.string(), requestId: z.string().optional() })
export type NoticeJob = z.infer<typeof NoticeJobSchema>
export const NotificationSchema = z.object({
  id: z.string(),
  kind: z.enum(NOTIFICATION_KINDS),
  /** profile-live carries the profile link; message-received a link and the thread id; the booking kinds carry ids only (none for requests-ignored). */
  payload: z.union([z.object({ url: z.string().url(), threadId: z.string().optional() }), z.object({ requestId: z.string().optional(), bookingId: z.string().optional(), quoteId: z.string().optional(), /** customers-waiting: how many, never who */ count: z.number().int().nonnegative().optional() })]),
  createdAt: z.string(),
  seenAt: z.string().nullable(),
  dismissedAt: z.string().nullable(),
  /** Additive: absent from older servers, null when the notice has no job or it cannot be resolved. */
  job: NoticeJobSchema.nullable().optional().catch(null),
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
  /** Private; YYYY-MM-DD; null until the person gives it (typed or confirmed after an ID scan). */
  birthDate: z.string().nullish(),
  /** true when the person has accepted an older version of the Terms (or none that is current): the app shows the accept pop-up (optional: an older server lacks it). */
  termsRequired: z.boolean().optional(),
  /** Whether the server takes payments (optional: an older server lacks it). */
  paymentsEnabled: z.boolean().optional(),
  /** Providers only (absent for a customer and from older servers): what is still needed before quoting, as on the provider profile. */
  quoteSteps: z.array(z.enum(['payout', 'consent', 'taxId'])).optional(),
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

/** DELETE /me: the person enters their password to confirm (403 WRONG_PASSWORD, 503 AUTH_BUSY). */
export const DeleteMeSchema = z.object({ password: z.string().min(1).max(128) })

/** PATCH /me: names, language of emails and private address; all optional (address null clears it). */
export const MePatchSchema = z
  .object({
    firstName: requiredText(60),
    lastName: requiredText(60),
    language: LangSchema,
    address: AddressSchema.nullable(),
    /** YYYY-MM-DD, a real day in the past and not more than 120 years ago; null clears it. */
    birthDate: BirthDateSchema.nullable(),
    /** Sign-up: the person ticked the Terms and Privacy Policy box; the server stores the time. */
    termsAccepted: z.literal(true),
    /** The version the person saw; the server refuses (409 terms-outdated) a version that is no longer the current one. Left out at sign-up. */
    termsVersion: z.string().max(20),
  })
  .partial()
export type MePatch = z.infer<typeof MePatchSchema>
