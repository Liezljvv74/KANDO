import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './users'

// One row per sent feedback mail, the rate-limit log. Holds no message and no email: user_id (null when signed out) and a salted
// hash of the address Vercel sets, never the raw address. Rows older than 2 days are deleted by the daily clean-up.
export const feedbackAttempts = pgTable(
  'feedback_attempts',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    ipHash: text('ip_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('feedback_attempts_user_idx').on(t.userId, t.createdAt), index('feedback_attempts_ip_idx').on(t.ipHash, t.createdAt)],
)
