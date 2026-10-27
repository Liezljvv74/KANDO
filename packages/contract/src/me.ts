import { z } from 'zod'

import { LangSchema } from './common'

export const MeSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  language: LangSchema.nullish(),
})
export type Me = z.infer<typeof MeSchema>

/** PATCH /me: the account name and/or the language of emails; both optional. */
export const MePatchSchema = z.object({ name: z.string().trim().min(1).max(100), language: LangSchema }).partial()
export type MePatch = z.infer<typeof MePatchSchema>
