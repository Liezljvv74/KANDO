import { sql } from 'drizzle-orm'
import { check, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

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
    // unique per issuer (section 14 UStG); two providers may print the same number
    number: text().notNull(),
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
    uniqueIndex('invoices_provider_id_number_idx').on(t.providerId, t.number),
    index('invoices_customer_id_idx').on(t.customerId),
  ],
)

/** The last number per series (`<full provider id>-<year>`), staff only; bumped in the same transaction as the invoice insert. */
export const invoiceCounters = pgTable('invoice_counters', {
  series: text().primaryKey(),
  last: integer().notNull(),
})

/**
 * KANDO's monthly invoice to a provider for the commission it kept (ledger `commission` rows of one month in TIME_ZONE).
 * Read by the provider's owner (rls.ts), written only on the owner connection (domain invoices/commission.ts), never
 * changed except `file_key` once the PDF is stored. No foreign key: an account deletion keeps it (legal retention).
 */
export const commissionInvoices = pgTable(
  'commission_invoices',
  {
    id: uuid().primaryKey().defaultRandom(),
    providerId: uuid('provider_id').notNull(),
    // YYYY-MM in TIME_ZONE
    month: text().notNull(),
    // K-<year>-00001: one series for the platform, unique
    number: text().notNull().unique(),
    total: numeric({ precision: 10, scale: 2 }).notNull(),
    currency: text().notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    // the CommissionDraft snapshot: the PDF a later run renders is the invoice that was issued
    draft: jsonb().notNull(),
    fileKey: text('file_key'),
  },
  (t) => [uniqueIndex('commission_invoices_provider_id_month_idx').on(t.providerId, t.month), check('commission_invoices_month_check', sql`month ~ '^[0-9]{4}-[0-9]{2}$'`)],
)
