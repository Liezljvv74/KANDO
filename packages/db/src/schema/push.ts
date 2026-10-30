import { sql } from 'drizzle-orm'
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { users } from './users'

// One row per device token, owner-only (rls.ts). A token re-registered by another person moves to them (domain savePushToken).
export const pushTokens = pgTable(
  'push_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text().notNull().unique(),
    platform: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('push_tokens_platform_check', sql`platform in ('ios','android')`), index('push_tokens_user_id_idx').on(t.userId)],
)
