import { sql } from 'drizzle-orm'
import { db, type Tx } from '@kando/db'
import { HelpTopicSchema, type HelpTopic } from '@kando/contract'
import { isLang } from '@kando/i18n'

import { retentionMonths } from '../account'
import { helpTopics } from './topics'

/** The approved Help topics in `lang` ('de' or 'en'; anything else is a programming error), in `sort` order. Everyone may read them. Rows are checked against the contract. */
export async function listHelpTopics(tx: Tx, lang: string): Promise<HelpTopic[]> {
  if (!isLang(lang)) throw new Error(`unknown language ${lang}`)
  const en = lang === 'en'
  const { rows } = await tx.execute(sql`
    SELECT slug, sort, "group", ${en ? sql`title_en` : sql`title_de`} AS title, ${en ? sql`body_en` : sql`body_de`} AS body
    FROM help_topics WHERE approved ORDER BY sort, slug`)
  return HelpTopicSchema.array().parse(rows)
}

/**
 * Makes the table match the code, in one transaction: one multi-row upsert by slug and the removal of topics whose slug is no
 * longer in the code (a retired topic must stop being served). Safe to run any number of times. Text, group and order follow the
 * code; `approved` is set on INSERT only, so the owner's approval (or hiding) is kept. A row that already matches is not touched.
 * The texts hold numbers from the code constants and DELETE_RETENTION_MONTHS at the time of the run: run again after changing a
 * rule constant or that variable. Owner connection. Returns what it did, including the months value used.
 */
export async function seedHelpTopics(exec: Pick<typeof db, 'transaction'> = db): Promise<{ upserted: number; removed: number; months: number }> {
  const topics = helpTopics()
  const rows = sql.join(topics.map((t) => sql`(${t.slug}, ${t.sort}, ${t.group}, ${t.titleDe}, ${t.bodyDe}, ${t.titleEn}, ${t.bodyEn}, ${t.approved})`), sql`, `)
  const slugs = sql.join(topics.map((t) => sql`${t.slug}`), sql`, `)
  const removed = await exec.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO help_topics (slug, sort, "group", title_de, body_de, title_en, body_en, approved) VALUES ${rows}
      ON CONFLICT (slug) DO UPDATE SET sort = excluded.sort, "group" = excluded."group", title_de = excluded.title_de, body_de = excluded.body_de,
        title_en = excluded.title_en, body_en = excluded.body_en, updated_at = now()
      WHERE (help_topics.sort, help_topics."group", help_topics.title_de, help_topics.body_de, help_topics.title_en, help_topics.body_en)
        IS DISTINCT FROM (excluded.sort, excluded."group", excluded.title_de, excluded.body_de, excluded.title_en, excluded.body_en)`)
    return (await tx.execute(sql`DELETE FROM help_topics WHERE slug NOT IN (${slugs})`)).rowCount ?? 0
  })
  return { upserted: topics.length, removed, months: retentionMonths() }
}
