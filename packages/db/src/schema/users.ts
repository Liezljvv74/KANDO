import { sql } from 'drizzle-orm'
import { boolean, check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// id is the Neon Auth user id. staff_role and suspended_* are written by staff only (see COLUMN_STAFF_ONLY in rls.ts).
export const users = pgTable(
  'users',
  {
    id: text().primaryKey(),
    email: text().notNull().unique(),
    language: text().notNull().default('de'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    // Private (owner and staff only); country is set (default 'DE') whenever the street is.
    addressStreet: text('address_street'),
    addressPostcode: text('address_postcode'),
    addressCity: text('address_city'),
    addressCountry: text('address_country'),
    isProvider: boolean('is_provider').notNull().default(false),
    // Push switches, the person's own: chat messages and reminders; every other booking and money event is always pushed.
    pushChat: boolean('push_chat').notNull().default(true),
    pushReminders: boolean('push_reminders').notNull().default(true),
    staffRole: text('staff_role'),
    suspendedUntil: timestamp('suspended_until', { withTimezone: true }),
    suspendedReason: text('suspended_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('users_staff_role_check', sql`staff_role in ('admin','reviewer')`),
    index('users_suspended_until_idx').on(t.suspendedUntil).where(sql`suspended_until IS NOT NULL`),
  ],
)
