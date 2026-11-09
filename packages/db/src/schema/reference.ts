import { type AnyPgColumn, boolean, check, customType, index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const point = customType<{ data: { lng: number; lat: number }; driverData: string }>({
  dataType: () => 'geometry(Point,4326)',
})

export const countries = pgTable('countries', {
  code: text().primaryKey(),
  nameDe: text('name_de').notNull(),
  nameEn: text('name_en').notNull(),
  postcodePattern: text('postcode_pattern').notNull(),
  currency: text().notNull().references((): AnyPgColumn => currencies.code),
})

export const currencies = pgTable('currencies', {
  code: text().primaryKey(),
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

// Help topics shown in the app. Staff-written content, readable by everyone, written only on the owner connection. `approved = false` hides a topic from the route.
// The six groups are HELP_GROUPS in @kando/contract (the check below repeats them; the db package cannot import the contract).
export const helpTopics = pgTable(
  'help_topics',
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull().unique(),
    sort: integer().notNull(),
    group: text().notNull(),
    titleDe: text('title_de').notNull(),
    bodyDe: text('body_de').notNull(),
    titleEn: text('title_en').notNull(),
    bodyEn: text('body_en').notNull(),
    approved: boolean().notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('help_topics_group_check', sql`${t.group} IN ('using-the-app', 'booking-and-paying', 'providers', 'money-and-fees', 'safety-and-rules', 'your-data')`),
    check('help_topics_text_check', sql`btrim(${t.titleDe}) <> '' AND btrim(${t.bodyDe}) <> '' AND btrim(${t.titleEn}) <> '' AND btrim(${t.bodyEn}) <> ''`),
  ],
)
