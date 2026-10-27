import { z } from 'zod'

export const CategorySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  requiredDocuments: z.array(z.string()).nullable(),
})
export type Category = z.infer<typeof CategorySchema>
