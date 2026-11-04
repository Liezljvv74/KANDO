import { z } from 'zod'

import { BirthDateSchema } from './me'

const text = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullish()

/** What the AI model must answer when it reads the front or back of an identity card. Parsed loosely: the server cleans it before it goes to the app. */
export const IdScanModelSchema = z.object({
  readable: z.boolean(),
  firstName: text(60),
  lastName: text(60),
  birthDate: z.string().max(20).nullish(),
  street: text(120),
  postcode: text(16),
  city: text(80),
})
export type IdScanModel = z.infer<typeof IdScanModelSchema>

/** POST /me/id-scan: suggestions for the sign-up details, read from one photo. Nothing is saved; the person checks, edits and saves. */
export const IdScanSchema = z.object({
  /** false: the photo is not an identity card or cannot be read; every field is then null. */
  readable: z.boolean(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  birthDate: BirthDateSchema.nullable(),
  street: z.string().nullable(),
  postcode: z.string().nullable(),
  city: z.string().nullable(),
})
export type IdScan = z.infer<typeof IdScanSchema>
