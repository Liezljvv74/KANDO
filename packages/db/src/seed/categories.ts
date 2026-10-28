import { sql } from 'drizzle-orm'
import { db } from '../client'

type Row = { slug: string; de: string; en: string; requiredDocuments: string[]; optionalDocuments?: string[] }

// Everyone submits a photo ID and a trade registration (private persons: their ID for now); the rest per category.
const BASE = ['id-document', 'trade-registration']

// Order is the display order (sort = index + 1); "other-services" is always listed last by the query.
export const CATEGORIES: Row[] = [
  { slug: 'photography', de: 'Fotografie', en: 'Photography', requiredDocuments: BASE, optionalDocuments: ['liability-insurance'] },
  { slug: 'dj', de: 'DJ', en: 'DJ', requiredDocuments: BASE, optionalDocuments: ['liability-insurance'] },
  { slug: 'catering', de: 'Catering', en: 'Catering', requiredDocuments: [...BASE, 'liability-insurance', 'hygiene-certificate', 'food-business-registration'] },
  { slug: 'digital-services', de: 'Digitale Dienstleistungen', en: 'Digital services', requiredDocuments: BASE, optionalDocuments: ['liability-insurance'] },
  { slug: 'marketing', de: 'Marketing', en: 'Marketing', requiredDocuments: BASE, optionalDocuments: ['liability-insurance'] },
  { slug: 'management-consulting', de: 'Management & Beratung', en: 'Management & consulting', requiredDocuments: BASE, optionalDocuments: ['liability-insurance'] },
  { slug: 'dog-walking', de: 'Gassi-Service', en: 'Dog walking', requiredDocuments: [...BASE, 'liability-insurance', 'permit'], optionalDocuments: ['police-certificate'] },
  { slug: 'babysitting', de: 'Babysitting', en: 'Babysitting', requiredDocuments: [...BASE, 'police-certificate'], optionalDocuments: ['liability-insurance', 'first-aid-certificate'] },
  { slug: 'cleaning', de: 'Reinigung', en: 'Cleaning', requiredDocuments: [...BASE, 'liability-insurance'], optionalDocuments: ['police-certificate'] },
  { slug: 'moving-clearance', de: 'Umzug & Entrümpelung', en: 'Moving & house clearance', requiredDocuments: [...BASE, 'liability-insurance'] },
  { slug: 'assembly', de: 'Montage & Aufbau', en: 'Assembly', requiredDocuments: [...BASE, 'liability-insurance'] },
  { slug: 'gardening', de: 'Gartenarbeit', en: 'Gardening', requiredDocuments: [...BASE, 'liability-insurance'] },
  { slug: 'small-repairs', de: 'Kleinreparaturen', en: 'Small repairs', requiredDocuments: [...BASE, 'liability-insurance'], optionalDocuments: ['craft-qualification'] },
  { slug: 'other-services', de: 'Sonstige Dienstleistungen', en: 'Other services', requiredDocuments: BASE, optionalDocuments: ['liability-insurance'] },
]

const list = (docs: string[] = []) => sql`ARRAY[${sql.join(docs.map((d) => sql`${d}`), sql`, `)}]::text[]`

/**
 * Upserts the categories and their German and English names; safe to run any number of times. The document lists are
 * set on INSERT only: a re-run must keep what staff edited in the back office (see applyDocumentLists to reset them).
 */
export async function seedCategories(): Promise<number> {
  for (const [i, c] of CATEGORIES.entries()) {
    const { rows } = await db.execute<{ id: string }>(sql`
      INSERT INTO categories (slug, country, sort, required_documents, optional_documents)
      VALUES (${c.slug}, 'DE', ${i + 1}, ${list(c.requiredDocuments)}, ${list(c.optionalDocuments)})
      ON CONFLICT (slug) DO UPDATE SET sort = excluded.sort
      RETURNING id`)
    for (const [lang, name] of [['de', c.de], ['en', c.en]] as const) {
      await db.execute(sql`
        INSERT INTO category_texts (category_id, lang, name) VALUES (${rows[0]!.id}, ${lang}, ${name})
        ON CONFLICT (category_id, lang) DO UPDATE SET name = excluded.name`)
    }
  }
  return CATEGORIES.length
}

/** Overwrites both document lists of the seeded categories with the table above (one-off for an existing database). */
export async function applyDocumentLists(): Promise<number> {
  for (const c of CATEGORIES)
    await db.execute(sql`UPDATE categories SET required_documents = ${list(c.requiredDocuments)}, optional_documents = ${list(c.optionalDocuments)} WHERE slug = ${c.slug}`)
  return CATEGORIES.length
}
