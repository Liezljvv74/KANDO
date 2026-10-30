import { sql } from 'drizzle-orm'
import { check, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { providers } from './providers'
import { bookings, requests } from './bookings'
import { users } from './users'

// Append-only for the two parties (rls.ts APPEND_ONLY_TABLES): one thread per request or booking, messages never edited or deleted.
export const threads = pgTable(
  'threads',
  {
    id: uuid().primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .unique()
      .references(() => requests.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id')
      .unique()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    customerId: text('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [check('threads_one_parent_check', sql`(request_id IS NULL) <> (booking_id IS NULL)`)],
)

export const messages = pgTable(
  'messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    senderId: text('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text().notNull(),
    body: text(),
    photoKey: text('photo_key'),
    // {type: 'quote' | 'acceptance' | 'additional-task', refId, amount?, currency?, version?}
    card: jsonb(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('messages_kind_check', sql`kind in ('text','photo','card')`),
    check('messages_content_check', sql`(kind = 'text' AND body IS NOT NULL AND body <> '' AND photo_key IS NULL AND card IS NULL) OR (kind = 'photo' AND photo_key IS NOT NULL AND body IS NULL AND card IS NULL) OR (kind = 'card' AND card IS NOT NULL AND body IS NULL AND photo_key IS NULL)`),
    index('messages_thread_id_created_at_idx').on(t.threadId, t.createdAt, t.id),
  ],
)

// Private to the blocker (rls.ts); is_blocked() answers for both directions.
export const blocks = pgTable(
  'blocks',
  {
    blockerId: text('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: text('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] })],
)

// Staff only (rls.ts). Later plans widen the kind list. The open-flag index folds a NULL user to '' (drizzle-kit has no NULLS NOT DISTINCT on indexes yet).
export const staffFlags = pgTable(
  'staff_flags',
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: text().notNull(),
    refId: text('ref_id').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    note: text(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by'),
  },
  (t) => [
    check('staff_flags_kind_check', sql`kind in ('contact-attempts','message-reported','chargeback','refund-failed','payment-unprocessed')`),
    uniqueIndex('staff_flags_open_idx').on(t.kind, t.refId, sql`coalesce(${t.userId}, '')`).where(sql`resolved_at IS NULL`),
  ],
)

// What the contact filter caught; staff only.
export const contactAttempts = pgTable('contact_attempts', {
  id: uuid().primaryKey().defaultRandom(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  threadId: uuid('thread_id').references(() => threads.id, { onDelete: 'cascade' }),
  hit: text().notNull(),
  text: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Staff only (rls.ts), only ever inserted: who tried to read which thread, and whether it was allowed (flag_id is the reason).
// No foreign keys on purpose: the log must survive the deletion of a staff account, a flag or a thread, and never block them.
export const staffAccessLog = pgTable(
  'staff_access_log',
  {
    id: uuid().primaryKey().defaultRandom(),
    staffId: text('staff_id').notNull(),
    threadId: text('thread_id').notNull(),
    flagId: uuid('flag_id'),
    outcome: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [check('staff_access_log_outcome_check', sql`outcome in ('allowed','denied')`)],
)
