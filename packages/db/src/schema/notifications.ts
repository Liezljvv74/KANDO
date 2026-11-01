import { sql } from 'drizzle-orm'
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './users'

// In-app messages, owner-only (rls.ts). Rows are created on the owner connection; the app only sets seen_at and dismissed_at.
export const notifications = pgTable(
  'notifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text().notNull(),
    payload: jsonb().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    seenAt: timestamp('seen_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    // NULL = still waiting in the mail/push outbox; rows that existed before the outbox count as sent
    mailedAt: timestamp('mailed_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    check('notifications_kind_check', sql`kind in ('profile-live','request-received','quote-received','booking-proposed','booking-accepted','booking-declined','booking-expired','payment-reminder','quote-expiring','request-expired','requests-ignored','pending-slot-requested','message-received','booking-paid','payment-received','payment-late-refunded','payout-setup-complete','customers-waiting','provider-available','refund-issued','job-finished','confirm-reminder','payment-released','was-job-done','booking-cancelled','no-show-reported','dispute-opened','dispute-decided','job-stopped','stop-amount-stated','additional-task-requested','review-requested','review-visible','provider-warning','invoice-ready','commission-invoice-ready','request-withdrawn','request-declined','request-reopened','request-updated','time-proposed','time-to-confirm','quote-confirmed')`),
    index('notifications_user_id_created_at_idx').on(t.userId, t.createdAt.desc()),
    index('notifications_requests_ignored_idx').on(t.userId, t.createdAt).where(sql`kind = 'requests-ignored'`),
  ],
)
