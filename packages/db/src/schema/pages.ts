import { sql } from 'drizzle-orm'
import { boolean, check, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'

// Website pages (legal pages, later posts). Public reference tables: staff write them, everyone reads.
export const pages = pgTable(
  'pages',
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull().unique(),
    published: boolean().notNull().default(false),
    kind: text().notNull().default('page'), // 'page' | 'post'
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [check('pages_kind_check', sql`${t.kind} in ('page','post')`)],
)

export const pageTexts = pgTable(
  'page_texts',
  {
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    lang: text().notNull(),
    title: text().notNull(),
    bodyMarkdown: text('body_markdown').notNull().default(''),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.lang] })],
)
