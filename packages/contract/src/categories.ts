import { z } from 'zod'

/** The document types a provider can submit, in display order; categories list which are required and which optional. */
export const DOCUMENT_TYPES = [
  'id-document',
  'trade-registration',
  'liability-insurance',
  'police-certificate',
  'hygiene-certificate',
  'food-business-registration',
  'permit',
  'craft-qualification',
  'first-aid-certificate',
] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export const CategorySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  requiredDocuments: z.array(z.string()).nullable(),
  optionalDocuments: z.array(z.string()).nullable(),
})
export type Category = z.infer<typeof CategorySchema>
