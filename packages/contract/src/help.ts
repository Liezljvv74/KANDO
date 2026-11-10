import { z } from 'zod'

/** The headings of the Help screen, in the order they are shown. Also in the CHECK of `help_topics` (packages/db/src/schema/reference.ts) and in migration 0040_help_topics.sql: change all three together. */
export const HELP_GROUPS = ['using-the-app', 'booking-and-paying', 'providers', 'money-and-fees', 'safety-and-rules', 'your-data'] as const
export type HelpGroup = (typeof HELP_GROUPS)[number]

/** The topic shown expanded at the top of the Help screen. */
export const HELP_OPENING_SLUG = 'what-is-kando'

/** One Help topic in the language of the request (GET /help); only approved topics are returned, in `sort` order. */
export const HelpTopicSchema = z.object({
  slug: z.string(),
  sort: z.number().int(),
  group: z.enum(HELP_GROUPS),
  title: z.string().min(1),
  body: z.string().min(1),
})
export type HelpTopic = z.infer<typeof HelpTopicSchema>
