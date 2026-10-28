import { customType, index, integer, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const point = customType<{ data: { lng: number; lat: number }; driverData: string }>({
  dataType: () => 'geometry(Point,4326)',
})

export const countries = pgTable('countries', {
  code: text().primaryKey(),
  nameDe: text('name_de').notNull(),
  nameEn: text('name_en').notNull(),
  postcodePattern: text('postcode_pattern').notNull(),
})

export const currencies = pgTable('currencies', {
  code: text().primaryKey(),
  minorUnits: integer('minor_units').notNull(),
})

export const postcodes = pgTable(
  'postcodes',
  {
    country: text().notNull().references(() => countries.code),
    code: text().notNull(),
    place: text().notNull(),
    state: text().notNull(),
    location: point().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.country, t.code] }),
    index('postcodes_location_gist').using('gist', sql`(${t.location}::geography)`),
  ],
)

export const categories = pgTable('categories', {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  country: text().notNull().default('DE').references(() => countries.code),
  sort: integer().notNull().default(0),
  requiredDocuments: text('required_documents').array().notNull().default(sql`'{}'`),
  // A slot a provider may fill; an approved one shows as a badge. Never part of the publish gate in rls.ts.
  optionalDocuments: text('optional_documents').array().notNull().default(sql`'{}'`),
})

export const categoryTexts = pgTable(
  'category_texts',
  {
    categoryId: uuid('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
    lang: text().notNull(),
    name: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.categoryId, t.lang] })],
)
