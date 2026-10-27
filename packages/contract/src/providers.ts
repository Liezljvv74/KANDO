import { DEFAULT_LANG } from '@kando/i18n'
import { z } from 'zod'

import { CurrencySchema, LangSchema, PriceTypeSchema } from './common'

export const SearchItemSchema = z.object({
  slug: z.string(),
  /** Business name or "Anna H."; never the full account name. */
  publicName: z.string(),
  photoUrl: z.string().nullable(),
  categories: z.array(z.string()),
  fromPrice: z.number().nullable(),
  currency: CurrencySchema,
  distanceKm: z.number().nullable(),
  worksRemotely: z.boolean(),
  isNew: z.boolean(),
})
export type SearchItem = z.infer<typeof SearchItemSchema>

export const SearchResultSchema = z.object({
  items: z.array(SearchItemSchema),
  page: z.number().int(),
  hasMore: z.boolean(),
})
export type SearchResult = z.infer<typeof SearchResultSchema>

export const SearchQuerySchema = z.object({
  category: z.string().optional(),
  postcode: z.string().optional(),
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  lang: LangSchema.default(DEFAULT_LANG),
  country: z.string().default('DE'),
})

export const LangQuerySchema = z.object({ lang: LangSchema.default(DEFAULT_LANG) })

export const ProviderServiceSchema = z.object({
  id: z.string(),
  category: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  priceType: PriceTypeSchema,
  price: z.number().nullable(),
  currency: CurrencySchema,
})

export const ProviderReferenceSchema = z.object({
  id: z.string(),
  clientName: z.string(),
  description: z.string(),
  year: z.number().int().nullable(),
})

export const ProviderDetailSchema = z.object({
  slug: z.string(),
  publicName: z.string(),
  providerType: z.string().nullish(),
  businessName: z.string().nullish(),
  impressum: z.string().nullish(),
  bio: z.string().nullish(),
  strengths: z.string().nullish(),
  skills: z.array(z.string()).nullish(),
  experience: z.string().nullish(),
  worksRemotely: z.boolean().nullish(),
  photoUrl: z.string().nullable(),
  place: z.string().nullable(),
  categories: z.array(z.string()),
  services: z.array(ProviderServiceSchema),
  references: z.array(ProviderReferenceSchema),
  photos: z.array(
    z.object({ id: z.string(), url: z.string().nullable(), alt: z.string().nullable() }),
  ),
  isNew: z.boolean(),
  /** True when the page texts are not in the reader's language, so the translate button shows. */
  translatable: z.boolean(),
})
export type ProviderDetail = z.infer<typeof ProviderDetailSchema>

/** The texts of a profile that the translate button sends and receives. */
export const TranslatableTextsSchema = z.object({
  bio: z.string().nullable(),
  strengths: z.string().nullable(),
  experience: z.string().nullable(),
  skills: z.array(z.string()),
  services: z.array(
    z.object({ id: z.string(), title: z.string(), description: z.string().nullable() }),
  ),
  references: z.array(z.object({ id: z.string(), description: z.string() })),
})
export type TranslatableTexts = z.infer<typeof TranslatableTextsSchema>

/** The translate endpoint needs an explicit target language (no default). */
export const TranslationQuerySchema = z.object({ lang: LangSchema })
