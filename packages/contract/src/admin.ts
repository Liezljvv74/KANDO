import { z } from 'zod'

import { LangSchema } from './common'

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

export const StaffRoleSchema = z.enum(['administrator', 'reviewer'])

export const AdminUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  language: LangSchema.nullable(),
  role: StaffRoleSchema.nullable(),
  createdAt: z.string(),
})
export type AdminUser = z.infer<typeof AdminUserSchema>

export const DocumentReviewInputSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(1000).optional(),
})
export type DocumentReviewInput = z.infer<typeof DocumentReviewInputSchema>
