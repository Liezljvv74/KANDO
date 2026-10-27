import { z } from 'zod'

import { LangSchema, requiredText } from './common'

/** The person's private address (country defaults to 'DE'; country-ready for later markets). */
export const AddressSchema = z.object({
  street: requiredText(120),
  postcode: requiredText(16),
  city: requiredText(80),
  country: z.string().length(2),
})
export type Address = z.infer<typeof AddressSchema>

/** An in-app message for the owner; the app only marks it seen or dismissed. */
export const NotificationSchema = z.object({
  id: z.string(),
  kind: z.enum(['profile-live']),
  payload: z.object({ url: z.string().url() }),
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
  notifications: z.array(NotificationSchema),
})
export type Me = z.infer<typeof MeSchema>

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
