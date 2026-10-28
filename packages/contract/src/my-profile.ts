import { z } from 'zod'

import { AmountSchema, CurrencySchema, docsOf, PriceTypeSchema, requiredText, text } from './common'

export const ProviderTypeSchema = z.enum(['individual', 'business'])

/** What a provider still lacks before Publish (filled by the server). */
export const MissingSchema = z.enum(['name', 'service', 'providerType', 'businessName', 'impressum', 'skills', 'experience', 'postcode', 'radius'])
export type Missing = z.infer<typeof MissingSchema>

export const MyProfileSchema = z.object({
  id: z.string(),
  publicName: z.string().nullish(),
  providerType: ProviderTypeSchema.nullish(),
  businessName: z.string().nullish(),
  impressum: z.string().nullish(),
  bio: z.string().nullish(),
  strengths: z.string().nullish(),
  skills: z.array(z.string()).nullish(),
  experience: z.string().nullish(),
  basePostcode: z.string().nullish(),
  serviceRadiusKm: z.number().int().nullish(),
  worksRemotely: z.boolean().nullish(),
  status: z.enum(['draft', 'published']),
  /** The public page's address part; set once the profile has been published. */
  slug: z.string().nullish(),
  suspendedUntil: z.string().nullable(),
  missing: z.array(MissingSchema),
})
export type MyProfile = z.infer<typeof MyProfileSchema>

/** Fields an owner may send; all optional (a save sends what changed), null clears a text. */
export const ProfileInputSchema = z
  .object({
    providerType: ProviderTypeSchema,
    businessName: text(120).nullable(),
    impressum: text(1000).nullable(),
    bio: text(2000).nullable(),
    strengths: text(1000).nullable(),
    skills: z.array(z.string().trim().min(1).max(50)).max(20),
    experience: text(500).nullable(),
    basePostcode: text(16).nullable(), // the country's postcode lookup is the real check
    serviceRadiusKm: z.number().int().min(1).max(200),
    worksRemotely: z.boolean(),
  })
  .partial()
export type ProfileInput = z.infer<typeof ProfileInputSchema>

export const OwnServiceSchema = z.object({
  id: z.string(),
  category: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  priceType: PriceTypeSchema.nullable(),
  price: z.number().nullable(),
  currency: CurrencySchema,
  visibleInSearch: z.boolean().optional(),
  waitingFor: z.array(z.string()).optional(),
  categoryInactive: z.boolean().optional(),
})
export type OwnService = z.infer<typeof OwnServiceSchema>

const serviceFields = {
  categoryId: z.string().min(1),
  title: text(120).optional(),
  description: text(2000).nullish(),
  priceType: PriceTypeSchema.optional(),
  price: AmountSchema.nullish(),
  currency: CurrencySchema.optional(), // the server fills it (EUR) when the app sends a category alone
}

/** A service may be saved with a category alone; once a price type is set, everything but "on request" needs a price. */
export const ServiceInputSchema = z
  .object(serviceFields)
  .refine((s) => s.priceType === undefined || s.priceType === 'on-request' || (s.price !== null && s.price !== undefined), {
    message: 'A price is required',
    path: ['price'],
  })
export type ServiceInput = z.infer<typeof ServiceInputSchema>
export const ServicePatchSchema = z.object(serviceFields).partial()
export type ServicePatch = z.infer<typeof ServicePatchSchema>

export const OwnReferenceSchema = z.object({
  id: z.string(),
  clientName: z.string(),
  description: z.string(),
  year: z.number().int().nullable(),
})
export type OwnReference = z.infer<typeof OwnReferenceSchema>

export const ReferenceInputSchema = z.object({
  clientName: requiredText(120),
  description: requiredText(1000),
  year: z
    .number()
    .int()
    .min(1970)
    .refine((y) => y <= new Date().getFullYear(), 'Year is in the future')
    .nullish(),
})
export type ReferenceInput = z.infer<typeof ReferenceInputSchema>
export const ReferencePatchSchema = ReferenceInputSchema.partial()
export type ReferencePatch = z.infer<typeof ReferencePatchSchema>

export const PhotoKindSchema = z.enum(['profile', 'portfolio'])
export const PhotoSchema = z.object({
  id: z.string(),
  kind: PhotoKindSchema,
  url: z.string().nullable(),
  alt: z.string().nullable(),
})
export type Photo = z.infer<typeof PhotoSchema>

export const DocumentStatusSchema = z.enum(['pending', 'approved', 'rejected'])
export const DocumentSchema = z.object({
  id: z.string(),
  requirement: z.string(),
  status: DocumentStatusSchema,
  note: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
})
export type Document = z.infer<typeof DocumentSchema>

/** Opens a document check for a file that was uploaded first. */
export const DocumentInputSchema = z.object({
  requirement: z.string().min(1),
  document: z.string().min(1),
})

export const OwnServicesListSchema = docsOf(OwnServiceSchema)
export const ReferencesListSchema = docsOf(OwnReferenceSchema)
export const PhotosListSchema = docsOf(PhotoSchema)
export const DocumentsListSchema = docsOf(DocumentSchema)
