import { z } from 'zod'

import { LangSchema, requiredText } from './common'

const jsonString = z.string().refine((s) => {
  try {
    JSON.parse(s)
    return true
  } catch {
    return false
  }
}, 'Not valid JSON')

export const AdminListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.string().max(100).optional(),
  /** A JSON string such as {"status":"pending"}; each route decides which fields it accepts. */
  filter: jsonString.optional(),
})
export type AdminListQuery = z.infer<typeof AdminListQuerySchema>

/** The stored values of users.staff_role: 'admin' is the Administrator. */
export const StaffRoleSchema = z.enum(['admin', 'reviewer'])

export const AdminUserSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string(),
  language: LangSchema.nullable(),
  staffRole: StaffRoleSchema.nullable(),
  isProvider: z.boolean(),
  suspendedUntil: z.string().nullable(),
  suspendedReason: z.string().nullable(),
  createdAt: z.string(),
})
export type AdminUser = z.infer<typeof AdminUserSchema>

export const DocumentReviewInputSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(1000).optional(),
})
export type DocumentReviewInput = z.infer<typeof DocumentReviewInputSchema>

/** `until` null lifts the suspension; a date suspends until then (a reason is required). */
export const SuspendInputSchema = z.object({
  until: z.iso.datetime({ offset: true }).nullable(),
  reason: z.string().trim().max(500),
})

export const StaffInputSchema = z.object({
  email: z.string().trim().toLowerCase().max(320),
  staffRole: StaffRoleSchema.nullable(),
})

const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80)

/** German is required; an empty English text means "none" (the site falls back to German). Defaults are applied by the domain, so a PATCH never resets a field. */
export const CategoryInputSchema = z.object({
  slug,
  sort: z.number().int().min(0).max(10_000).optional(),
  requiredDocuments: z.array(z.string().max(50)).max(10).optional(),
  names: z.object({ de: requiredText(100), en: z.string().trim().max(100).optional() }),
})
export const CategoryUpdateSchema = CategoryInputSchema.partial()

const pageText = z.object({ title: z.string().trim().max(200), body: z.string().max(100_000) })
export const PageInputSchema = z.object({
  slug,
  kind: z.enum(['page', 'post']).optional(),
  published: z.boolean().optional(),
  texts: z.object({ de: pageText.refine((t) => t.title.length > 0, 'Title required'), en: pageText.optional() }),
})
export const PageUpdateSchema = PageInputSchema.partial()
