import { index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

// Stored machine translations, keyed by sha256 of the source text. Insert-only for app_user (see INSERT_ONLY_TABLES).
export const translations = pgTable(
  'translations',
  {
    id: uuid().primaryKey().defaultRandom(),
    key: text().notNull(),
    lang: text().notNull(),
    text: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('translations_key_lang_unique').on(t.key, t.lang)],
)

// One row per model call, the rate-limit log. client_key is `user:<id>` or a salted ip hash, never a raw address.
export const translationRequests = pgTable(
  'translation_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    clientKey: text('client_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('translation_requests_client_idx').on(t.clientKey, t.createdAt)],
)
