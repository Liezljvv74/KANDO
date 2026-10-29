import { sql } from 'drizzle-orm'
import { check, index, numeric, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { providers } from './providers'
import { users } from './users'

/**
 * Money movements, staff only (rls.ts), append-only (trigger ledger_append_only): a refund or adjustment is a new row.
 * Single-entry rows with a kind; per booking, once settled: charge = refund + transfer + commission. No foreign keys:
 * deleting a booking or an account must not take its money records with it.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid().primaryKey().defaultRandom(),
    bookingId: uuid('booking_id').notNull(),
    providerId: uuid('provider_id').notNull(),
    kind: text().notNull(),
    amount: numeric({ precision: 10, scale: 2 }).notNull(),
    currency: text().notNull().default('EUR'),
    // the gateway's id of the charge, refund or transfer (opaque)
    gatewayRef: text('gateway_ref'),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ledger_entries_booking_id_idx').on(t.bookingId),
    check('ledger_entries_kind_check', sql`kind in ('charge','refund','transfer','commission')`),
    check('ledger_entries_amount_check', sql`amount > 0`),
  ],
)

// Gateway webhook events already processed (the Stripe event id), staff only: a redelivered event is processed once.
export const stripeEvents = pgTable('stripe_events', {
  id: text().primaryKey(),
  type: text().notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
})

// "Notify me when available": private to the customer (rls.ts); the provider only ever learns the count.
export const availabilityWatches = pgTable(
  'availability_watches',
  {
    customerId: text('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.customerId, t.providerId] }), index('availability_watches_provider_id_idx').on(t.providerId)],
)
