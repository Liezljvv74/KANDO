import { sql } from 'drizzle-orm'
import { type AnyPgColumn, boolean, check, index, integer, jsonb, numeric, pgTable, real, uniqueIndex, text, timestamp, uuid } from 'drizzle-orm/pg-core'
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
    index('photos_owner_id_idx').on(t.ownerId),
    uniqueIndex('photos_one_profile_idx').on(t.ownerId).where(sql`kind = 'profile'`),
  ],
)

// A PDF uploaded but not yet submitted for a check (private bucket). Submitting turns it into a documents row.
export const privateFiles = pgTable(
  'private_files',
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    key: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('private_files_owner_id_idx').on(t.ownerId)],
)

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
    // Set when the stored image was deleted on purpose (a photo ID, 30 days after the check); the row stays as the record. Staff-only column.
    imageDeletedAt: timestamp('image_deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('documents_status_check', sql`status in ('pending','approved','rejected')`),
    index('documents_owner_id_idx').on(t.ownerId),
    // Backstop for the one-pending-check rule (the domain also checks, under a per-user lock).
    uniqueIndex('documents_one_pending_idx').on(t.ownerId, t.requirement).where(sql`status = 'pending'`),
  ],
)

// The AI's suggestion for one document (one row per document, so one check per version). Staff-only: the verdict, a short "why not
// approved" text without personal data from the document, the model id and the cost; nothing read from the document is kept.
// decision is null while the check runs (a run that died leaves it null: the document stays pending for staff, as without AI).
export const documentAiChecks = pgTable(
  'document_ai_checks',
  {
    id: uuid().primaryKey().defaultRandom(),
    // Null once the document is gone: the row stays as the record of what the call cost (verdict, confidence and reason are cleared by
    // a trigger when the document is deleted), so deleting documents cannot reset the monthly cap or the hourly limit.
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    // Whose call it was, for the hourly limit; null after the account is deleted.
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
    verdict: text(),
    confidence: real(),
    explanation: text(),
    model: text().notNull(),
    sampled: boolean().notNull().default(false),
    decision: text(),
    // Why there is no verdict: rate-limit, cap, error, timeout, no-name, staff-decided.
    failure: text(),
    // What the call cost, in euro (OpenRouter reports US dollars, counted one to one: slightly more than it is worth, so the cap errs safe).
    costEur: numeric('cost_eur', { precision: 10, scale: 6 }).notNull().default('0'),
    // What staff decided afterwards ('approved' or 'rejected'), to compare with the suggestion.
    staffDecision: text('staff_decision'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('document_ai_checks_document_id_idx').on(t.documentId),
    index('document_ai_checks_created_at_idx').on(t.createdAt),
    index('document_ai_checks_owner_idx').on(t.ownerId, t.createdAt),
    check('document_ai_checks_verdict_check', sql`verdict is null or verdict in ('ok','problem')`),
    check('document_ai_checks_decision_check', sql`decision is null or decision in ('auto-approved','sent-to-staff')`),
    check('document_ai_checks_staff_decision_check', sql`staff_decision is null or staff_decision in ('approved','rejected')`),
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

// A legal-duty record kept after an account is deleted (the trader's basic details and the metadata of their submitted
// documents, whose objects stay in storage until delete_after). No foreign keys: the person is gone. app_user has no access.
export const retainedRecords = pgTable(
  'retained_records',
  {
    id: uuid().primaryKey().defaultRandom(),
    formerUserId: text('former_user_id').notNull(),
    details: jsonb().notNull(),
    documents: jsonb().notNull().default(sql`'[]'::jsonb`),
    deleteAfter: timestamp('delete_after', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('retained_records_delete_after_idx').on(t.deleteAfter)],
)
