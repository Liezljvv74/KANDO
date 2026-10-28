import { sql } from 'drizzle-orm'
import { type AnyPgColumn, check, index, integer, pgTable, uniqueIndex, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { providers } from './providers'
import { users } from './users'

// Public images (the key points into the public media bucket). A portfolio photo belongs to a provider; the person's
// picture is the one 'profile' row without a provider, readable once the owner's provider is live (see rls.ts).
export const photos = pgTable(
  'photos',
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    providerId: uuid('provider_id').references((): AnyPgColumn => providers.id, { onDelete: 'cascade' }),
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
    check('photos_profile_provider_check', sql`(kind = 'profile') = (provider_id IS NULL)`),
    index('photos_provider_id_idx').on(t.providerId),
    uniqueIndex('photos_one_profile_idx').on(t.ownerId).where(sql`kind = 'profile'`),
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
    // Backstop for the one-pending-check rule (the domain also checks, under a per-user lock).
    uniqueIndex('documents_one_pending_idx').on(t.ownerId, t.requirement).where(sql`status = 'pending'`),
  ],
)

// Objects whose storage delete is still owed (an erased account's files): written with the delete, cleared once the object is gone.
// app_user has no access (STAFF_ONLY_TABLES); a daily job retries what is left.
export const pendingObjectDeletes = pgTable('pending_object_deletes', {
  id: uuid().primaryKey().defaultRandom(),
  bucket: text().notNull(),
  key: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
