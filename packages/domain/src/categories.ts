import { sql } from 'drizzle-orm'
import type { Tx } from '@kando/db'
import type { Category } from '@kando/contract'
import { DEFAULT_LANG } from '@kando/i18n'

/** Categories by `sort`, name in `lang` (German when missing), the catch-all "other-services" always last. */
export async function listCategories(tx: Tx, lang: string): Promise<Category[]> {
  const { rows } = await tx.execute<Category>(sql`
    SELECT c.id, c.slug, COALESCE(t.name, d.name, c.slug) AS name, c.required_documents AS "requiredDocuments"
    FROM categories c
    LEFT JOIN category_texts t ON t.category_id = c.id AND t.lang = ${lang}
    LEFT JOIN category_texts d ON d.category_id = c.id AND d.lang = ${DEFAULT_LANG}
    ORDER BY (c.slug = 'other-services'), c.sort, name, c.id`)
  return rows
}
