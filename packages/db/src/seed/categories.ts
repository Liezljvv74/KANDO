import { sql } from 'drizzle-orm'
import { db } from '../client'

type Row = { slug: string; de: string; en: string; requiredDocuments?: string[] }

// Order is the display order (sort = index + 1); "other-services" is always listed last by the query.
export const CATEGORIES: Row[] = [
  { slug: 'photography', de: 'Fotografie', en: 'Photography' },
  { slug: 'dj', de: 'DJ', en: 'DJ' },
  { slug: 'catering', de: 'Catering', en: 'Catering' },
  { slug: 'digital-services', de: 'Digitale Dienstleistungen', en: 'Digital services' },
  { slug: 'marketing', de: 'Marketing', en: 'Marketing' },
  { slug: 'management-consulting', de: 'Management & Beratung', en: 'Management & consulting' },
  { slug: 'dog-walking', de: 'Gassi-Service', en: 'Dog walking' },
  { slug: 'babysitting', de: 'Babysitting', en: 'Babysitting', requiredDocuments: ['police-certificate'] },
  { slug: 'cleaning', de: 'Reinigung', en: 'Cleaning' },
  { slug: 'moving-clearance', de: 'Umzug & Entrümpelung', en: 'Moving & house clearance' },
  { slug: 'assembly', de: 'Montage & Aufbau', en: 'Assembly' },
  { slug: 'gardening', de: 'Gartenarbeit', en: 'Gardening' },
  { slug: 'small-repairs', de: 'Kleinreparaturen', en: 'Small repairs' },
  { slug: 'other-services', de: 'Sonstige Dienstleistungen', en: 'Other services' },
]

/** Upserts the categories and their German and English names; safe to run any number of times. */
export async function seedCategories(): Promise<number> {
  for (const [i, c] of CATEGORIES.entries()) {
    const docs = sql`ARRAY[${sql.join((c.requiredDocuments ?? []).map((d) => sql`${d}`), sql`, `)}]::text[]`
    const { rows } = await db.execute<{ id: string }>(sql`
      INSERT INTO categories (slug, country, sort, required_documents) VALUES (${c.slug}, 'DE', ${i + 1}, ${docs})
      ON CONFLICT (slug) DO UPDATE SET sort = excluded.sort, required_documents = excluded.required_documents
      RETURNING id`)
    for (const [lang, name] of [['de', c.de], ['en', c.en]] as const) {
      await db.execute(sql`
        INSERT INTO category_texts (category_id, lang, name) VALUES (${rows[0]!.id}, ${lang}, ${name})
        ON CONFLICT (category_id, lang) DO UPDATE SET name = excluded.name`)
    }
  }
  return CATEGORIES.length
}
