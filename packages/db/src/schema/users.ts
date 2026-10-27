import { sql } from 'drizzle-orm'
import { boolean, check, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// id is the Neon Auth user id. staff_role and suspended_* are written by staff only (see COLUMN_STAFF_ONLY in rls.ts).
export const users = pgTable(
  'users',
  {
    id: text().primaryKey(),
    email: text().notNull().unique(),
    language: text().notNull().default('de'),
    name: text(),
    isProvider: boolean('is_provider').notNull().default(false),
    staffRole: text('staff_role'),
    suspendedUntil: timestamp('suspended_until', { withTimezone: true }),
    suspendedReason: text('suspended_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [check('users_staff_role_check', sql`staff_role in ('admin','reviewer')`)],
)
