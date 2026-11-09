import { sql } from 'drizzle-orm'
import { db, type Tx } from '@kando/db'
import type { HelpTopic } from '@kando/contract'

import { helpTopics } from './topics'

/** The approved Help topics in the language of the request (German for any other value), in `sort` order. Everyone may read them. */
export async function listHelpTopics(tx: Tx, lang: string): Promise<HelpTopic[]> {
  const en = lang === 'en'
  const { rows } = await tx.execute<HelpTopic>(sql`
    SELECT slug, sort, "group", ${en ? sql`title_en` : sql`title_de`} AS title, ${en ? sql`body_en` : sql`body_de`} AS body
    FROM help_topics WHERE approved ORDER BY sort, slug`)
  return rows
}

/**
 * Upserts the topics by slug; safe to run any number of times. Text, group and order follow the code; `approved` is set on
 * INSERT only, so a re-run keeps what the owner approved (and never hides a published topic). A row that already matches is not touched.
 * Owner connection. Topics removed from the code are not deleted.
 */
export async function seedHelpTopics(exec: Pick<typeof db, 'execute'> = db): Promise<number> {
  const topics = helpTopics()
  for (const t of topics) {
    await exec.execute(sql`
      INSERT INTO help_topics (slug, sort, "group", title_de, body_de, title_en, body_en, approved)
      VALUES (${t.slug}, ${t.sort}, ${t.group}, ${t.titleDe}, ${t.bodyDe}, ${t.titleEn}, ${t.bodyEn}, ${t.approved})
      ON CONFLICT (slug) DO UPDATE SET sort = excluded.sort, "group" = excluded."group", title_de = excluded.title_de, body_de = excluded.body_de,
        title_en = excluded.title_en, body_en = excluded.body_en, updated_at = now()
      WHERE (help_topics.sort, help_topics."group", help_topics.title_de, help_topics.body_de, help_topics.title_en, help_topics.body_en)
        IS DISTINCT FROM (excluded.sort, excluded."group", excluded.title_de, excluded.body_de, excluded.title_en, excluded.body_en)`)
  }
  return topics.length
}
