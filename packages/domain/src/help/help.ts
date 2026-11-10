import { sql } from 'drizzle-orm'
import { db, type Tx } from '@kando/db'
import { HelpTopicSchema, type HelpTopic } from '@kando/contract'
import { isLang } from '@kando/i18n'

import { retentionMonths } from '../account'
import { defaultEmbedder, EMBEDDING_MODEL, type Embedder } from './search'
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
export async function seedHelpTopics(
  exec: Pick<typeof db, 'transaction'> = db,
  /** The embedder for the search vectors (default: the real one when OPENROUTER_API_KEY is set); null: no vectors, search is keyword only. */
  embed: Embedder | null = defaultEmbedder(),
): Promise<{ upserted: number; removed: number; months: number; embedded: number; embedNote: string }> {
  const topics = helpTopics()
  const { rows: existing } = await exec.transaction((tx) =>
    tx.execute<{ slug: string; title_de: string; body_de: string; title_en: string; body_en: string; embedding_de: unknown; embedding_en: unknown; embedding_model: string | null }>(
      sql`SELECT slug, title_de, body_de, title_en, body_en, embedding_de, embedding_en, embedding_model FROM help_topics`,
    ),
  )
  const old = new Map(existing.map((r) => [r.slug, r]))
  // A topic needs vectors when it has none, the model changed or its text changed; an unchanged one with the same model skips the call.
  const stale = topics.filter((t) => {
    const o = old.get(t.slug)
    return !o || !o.embedding_de || !o.embedding_en || o.embedding_model !== EMBEDDING_MODEL || o.title_de !== t.titleDe || o.body_de !== t.bodyDe || o.title_en !== t.titleEn || o.body_en !== t.bodyEn
  })
  const vectors = new Map<string, [number[], number[]]>()
  let embedNote = stale.length ? 'no embeddings (no key)' : 'all embeddings up to date'
  if (embed && stale.length) {
    try {
      const out = await embed(stale.flatMap((t) => [`${t.titleDe}\n${t.bodyDe}`, `${t.titleEn}\n${t.bodyEn}`]))
      stale.forEach((t, i) => vectors.set(t.slug, [out[2 * i]!, out[2 * i + 1]!]))
      embedNote = `${stale.length} topics embedded with ${EMBEDDING_MODEL}`
    } catch {
      embedNote = 'no embeddings (the embedding call failed)'
    }
  }

  const rows = sql.join(topics.map((t) => sql`(${t.slug}, ${t.sort}, ${t.group}, ${t.titleDe}, ${t.bodyDe}, ${t.titleEn}, ${t.bodyEn}, ${t.approved})`), sql`, `)
  const slugs = sql.join(topics.map((t) => sql`${t.slug}`), sql`, `)
  const removed = await exec.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO help_topics (slug, sort, "group", title_de, body_de, title_en, body_en, approved) VALUES ${rows}
      ON CONFLICT (slug) DO UPDATE SET sort = excluded.sort, "group" = excluded."group", title_de = excluded.title_de, body_de = excluded.body_de,
        title_en = excluded.title_en, body_en = excluded.body_en, updated_at = now(),
        -- changed text: the old vectors no longer describe it
        embedding_de = CASE WHEN (help_topics.title_de, help_topics.body_de) IS DISTINCT FROM (excluded.title_de, excluded.body_de) THEN NULL ELSE help_topics.embedding_de END,
        embedding_en = CASE WHEN (help_topics.title_en, help_topics.body_en) IS DISTINCT FROM (excluded.title_en, excluded.body_en) THEN NULL ELSE help_topics.embedding_en END
      WHERE (help_topics.sort, help_topics."group", help_topics.title_de, help_topics.body_de, help_topics.title_en, help_topics.body_en)
        IS DISTINCT FROM (excluded.sort, excluded."group", excluded.title_de, excluded.body_de, excluded.title_en, excluded.body_en)`)
    if (vectors.size) {
      const v = sql.join([...vectors].map(([slug, [de, en]]) => sql`(${slug}, ${JSON.stringify(de)}, ${JSON.stringify(en)})`), sql`, `)
      await tx.execute(sql`
        UPDATE help_topics h SET embedding_de = v.de::jsonb, embedding_en = v.en::jsonb, embedding_model = ${EMBEDDING_MODEL}
        FROM (VALUES ${v}) AS v(slug, de, en) WHERE h.slug = v.slug`)
    }
    return (await tx.execute(sql`DELETE FROM help_topics WHERE slug NOT IN (${slugs})`)).rowCount ?? 0
  })
  return { upserted: topics.length, removed, months: retentionMonths(), embedded: vectors.size, embedNote }
}
