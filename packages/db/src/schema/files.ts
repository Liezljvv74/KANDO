import { sql } from 'drizzle-orm'
import { type AnyPgColumn, check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { providers } from './providers'
import { users } from './users'

// Public images (the key points into the public media bucket). Readable with the provider's public page.
export const photos = pgTable(
  'photos',
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    providerId: uuid('provider_id')
      .notNull()
      .references((): AnyPgColumn => providers.id, { onDelete: 'cascade' }),
    kind: text().notNull(),
    key: text().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    alt: text(),
    sort: integer().notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('photos_kind_check', sql`kind in ('profile','portfolio')`),
    index('photos_provider_id_idx').on(t.providerId),
  ],
)

// A PDF uploaded but not yet submitted for a check (private bucket). Submitting turns it into a documents row.
export const privateFiles = pgTable('private_files', {
  id: uuid().primaryKey().defaultRandom(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id),
  key: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Uploaded verification files (the key points into the private bucket). Staff review them: owners cannot set the verdict.
export const documents = pgTable(
  'documents',
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    requirement: text().notNull(),
    key: text().notNull(),
    status: text().notNull().default('pending'),
    note: text(),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('documents_status_check', sql`status in ('pending','approved','rejected')`),
    index('documents_owner_id_idx').on(t.ownerId),
  ],
)
