import { sql } from 'drizzle-orm'
import { check, index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * An issued invoice or receipt for one booking group (the root booking and its additional tasks), in the provider's name.
 * Read by its two parties (rls.ts), written only on the owner connection (domain invoices/issue.ts), never changed except
 * `file_key` once the PDF is stored. No foreign keys: an account deletion keeps the invoice (legal retention).
 */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid().primaryKey().defaultRandom(),
    rootBookingId: uuid('root_booking_id').notNull().unique(),
    providerId: uuid('provider_id').notNull(),
    customerId: text('customer_id').notNull(),
    number: text().notNull().unique(),
    kind: text().notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    currency: text().notNull(),
    total: numeric({ precision: 10, scale: 2 }).notNull(),
    // the InvoiceDraft snapshot: later profile changes never alter an issued invoice
    draft: jsonb().notNull(),
    // null until the PDF is stored (a storage failure is retried by the timers)
    fileKey: text('file_key'),
  },
  (t) => [
    check('invoices_kind_check', sql`kind in ('invoice','receipt')`),
    index('invoices_provider_id_idx').on(t.providerId),
    index('invoices_customer_id_idx').on(t.customerId),
  ],
)

/** The last number per series (`<provider>-<year>`), staff only; bumped in the same transaction as the invoice insert. */
export const invoiceCounters = pgTable('invoice_counters', {
  series: text().primaryKey(),
  last: integer().notNull(),
})
