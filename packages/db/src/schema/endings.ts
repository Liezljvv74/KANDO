import { sql } from 'drizzle-orm'
import { boolean, check, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { bookings } from './bookings'
import { users } from './users'

/**
 * One per booking. Readable by the two parties, written only on the owner connection after the domain checked the caller
 * (rls.ts PUBLISHED_READ_TABLES). Deleted with the booking's account (account.ts), like the chat it rests on.
 * decided_by is the staff member's id without a foreign key: the decision stays when that staff account goes.
 */
export const disputes = pgTable(
  'disputes',
  {
    id: uuid().primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .unique()
      .references(() => bookings.id),
    // the side that opened it; null = the system (no response, chargeback)
    openedBy: text('opened_by'),
    reason: text().notNull(),
    description: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    decideBy: timestamp('decide_by', { withTimezone: true }).notNull(),
    decision: text(),
    providerShare: numeric('provider_share', { precision: 10, scale: 2 }),
    decisionReason: text('decision_reason'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  () => [
    check('disputes_opened_by_check', sql`opened_by in ('customer','provider')`),
    check('disputes_reason_check', sql`reason in ('problem','no-show-objection','no-response','stop-disagreed','chargeback')`),
    check('disputes_decision_check', sql`decision in ('full-payout','partial','full-refund')`),
  ],
)

/**
 * One per author and (root) booking. Readable once visible and not hidden, and always by its author (rls.ts
 * PUBLISHED_READ_TABLES); written only on the owner connection.
 */
export const reviews = pgTable(
  'reviews',
  {
    id: uuid().primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id),
    subjectId: text('subject_id')
      .notNull()
      .references(() => users.id),
    authorRole: text('author_role').notNull(),
    stars: integer().notNull(),
    text: text(),
    hidden: boolean().notNull().default(false),
    hiddenReason: text('hidden_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    visibleAt: timestamp('visible_at', { withTimezone: true }),
  },
  (t) => [
    check('reviews_author_role_check', sql`author_role in ('customer','provider')`),
    check('reviews_stars_check', sql`stars between 1 and 5`),
    uniqueIndex('reviews_booking_id_author_id_idx').on(t.bookingId, t.authorId),
  ],
)
