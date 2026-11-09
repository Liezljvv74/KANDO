import { sql } from 'drizzle-orm'
import type { Tx } from '@kando/db'
import type { Category } from '@kando/contract'
import { DEFAULT_LANG } from '@kando/i18n'

const collators = new Map<string, Intl.Collator>()
function collatorFor(lang: string) {
  let c = collators.get(lang)
  if (!c) {
    try {
      c = new Intl.Collator(lang)
    } catch {
      c = new Intl.Collator(DEFAULT_LANG) // malformed language tag
    }
    collators.set(lang, c)
  }
  return c
}

/** Categories alphabetical by their name in `lang` (German when missing; the language's collation), the catch-all "other-services" always last. */
export async function listCategories(tx: Tx, lang: string): Promise<Category[]> {
  const { rows } = await tx.execute<Category>(sql`
    SELECT c.id, c.slug, COALESCE(t.name, d.name, c.slug) AS name, c.required_documents AS "requiredDocuments", c.optional_documents AS "optionalDocuments"
    FROM categories c
    LEFT JOIN category_texts t ON t.category_id = c.id AND t.lang = ${lang}
    LEFT JOIN category_texts d ON d.category_id = c.id AND d.lang = ${DEFAULT_LANG}
    ORDER BY c.id`)
  const collator = collatorFor(lang)
  const last = (c: Category) => c.slug === 'other-services'
  return rows.sort((a, b) => Number(last(a)) - Number(last(b)) || collator.compare(a.name, b.name) || a.id.localeCompare(b.id))
}
