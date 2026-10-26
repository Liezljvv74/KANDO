import { z } from 'zod'

import { LangSchema } from './common'

export const MeSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  language: LangSchema.nullish(),
})
export type Me = z.infer<typeof MeSchema>

export const MeUpdateSchema = z.object({ name: z.string().trim().min(1).max(100) })
