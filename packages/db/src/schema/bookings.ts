import { sql } from 'drizzle-orm'
import { boolean, check, index, uniqueIndex, integer, numeric, date, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { providers, services } from './providers'
import { users } from './users'

// Private to the two parties (rls.ts). Status columns stay writable by them: transitions are enforced in the domain.
// Money columns are staff-only (rls.ts COLUMN_STAFF_ONLY).
export const requests = pgTable(
  'requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    customerId: text('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
    description: text().notNull(),
    preferredDate: date('preferred_date'),
    status: text().notNull().default('open'),
    answerBy: timestamp('answer_by', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('requests_status_check', sql`status in ('open','quoted','booked','expired','withdrawn')`),
    index('requests_provider_id_status_idx').on(t.providerId, t.status),
    index('requests_customer_id_idx').on(t.customerId),
  ],
)

export const quotes = pgTable(
  'quotes',
  {
    id: uuid().primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    version: integer().notNull().default(1),
    amount: numeric({ precision: 10, scale: 2 }).notNull(),
    currency: text().notNull().default('EUR'),
    scope: text().notNull(),
    // A suggested time only; the customer confirms a date and time separately.
    startAt: timestamp('start_at', { withTimezone: true }),
    durationMin: integer('duration_min'),
    status: text().notNull().default('sent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('quotes_status_check', sql`status in ('sent','accepted','superseded','expired','declined')`),
    index('quotes_provider_id_status_idx').on(t.providerId, t.status),
    index('quotes_start_at_idx').on(t.startAt),
    uniqueIndex('quotes_request_id_version_idx').on(t.requestId, t.version),
  ],
)

/**
 * The booking columns the app role writes. The others (money, payment) are staff-only (rls.ts COLUMN_STAFF_ONLY.bookings):
 * a Drizzle insert names every column of its table, so app inserts go through `bookingAppInsert` (../app-tables.ts), this shape.
 */
export const bookingAppColumns = () => ({
  id: uuid().primaryKey().defaultRandom(),
  customerId: text('customer_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  providerId: uuid('provider_id')
    .notNull()
    .references(() => providers.id, { onDelete: 'cascade' }),
  serviceId: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
  quoteId: uuid('quote_id').references(() => quotes.id, { onDelete: 'set null' }),
  // Filled from the quote by the bookings_fill_amount trigger, never changed (rls.ts).
  requestId: uuid('request_id').references(() => requests.id),
  source: text().notNull(),
  status: text().notNull().default('proposed'),
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),
  durationMin: integer('duration_min').notNull(),
  onSite: boolean('on_site').notNull().default(true),
  addressStreet: text('address_street'),
  addressPostcode: text('address_postcode'),
  addressCity: text('address_city'),
  note: text(),
  answerBy: timestamp('answer_by', { withTimezone: true }),
  payBy: timestamp('pay_by', { withTimezone: true }),
  // When the booking became awaiting-payment: the payment reminders count from here.
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  counterBy: text('counter_by'),
  remindedHalfAt: timestamp('reminded_half_at', { withTimezone: true }),
  remindedLastAt: timestamp('reminded_last_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const bookings = pgTable(
  'bookings',
  {
    ...bookingAppColumns(),
    // amount and currency come from the quote or the service (trigger bookings_fill_amount), never from the app
    amount: numeric({ precision: 10, scale: 2 }).notNull(),
    currency: text().notNull().default('EUR'),
    // copied from COMMISSION_RATE at payment, so a later change never alters old bookings
    commissionRate: numeric('commission_rate', { precision: 5, scale: 4 }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paymentRef: text('payment_ref'),
    checkoutRef: text('checkout_ref'),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (t) => [
    check('bookings_source_check', sql`source in ('quote','direct')`),
    check('bookings_status_check', sql`status in ('proposed','awaiting-payment','confirmed','expired','declined','withdrawn')`),
    check('bookings_counter_by_check', sql`counter_by in ('provider','customer')`),
    check('bookings_pay_by_check', sql`status <> 'awaiting-payment' OR pay_by IS NOT NULL`),
    check('bookings_accepted_at_check', sql`status <> 'awaiting-payment' OR accepted_at IS NOT NULL`),
    index('bookings_provider_id_status_idx').on(t.providerId, t.status),
    index('bookings_start_at_idx').on(t.startAt),
    index('bookings_customer_id_idx').on(t.customerId),
    index('bookings_request_id_idx').on(t.requestId),
  ],
)
