import { sql } from 'drizzle-orm'
import type { Tx } from '@kando/db'
import type { Lang } from '@kando/i18n'

export type Page = { slug: string; kind: string; title: string; bodyMarkdown: string }

/** A published page by slug in `lang`, German when that language has no text; null when unknown, unpublished or without any text. */
export async function getPage(tx: Tx, slug: string, lang: Lang): Promise<Page | null> {
  const { rows } = await tx.execute<Page>(sql`
    SELECT p.slug, p.kind, COALESCE(t.title, d.title) AS title, COALESCE(t.body_markdown, d.body_markdown) AS "bodyMarkdown"
    FROM pages p
    LEFT JOIN page_texts t ON t.page_id = p.id AND t.lang = ${lang}
    LEFT JOIN page_texts d ON d.page_id = p.id AND d.lang = 'de'
    WHERE p.slug = ${slug} AND p.published AND COALESCE(t.title, d.title) IS NOT NULL`)
  return rows[0] ?? null
}

/** Slugs of the published pages, for the sitemap. */
export async function publishedPages(tx: Tx): Promise<{ slug: string }[]> {
  return (
    await tx.execute<{ slug: string }>(sql`SELECT slug FROM pages WHERE published ORDER BY slug`)
  ).rows
}
