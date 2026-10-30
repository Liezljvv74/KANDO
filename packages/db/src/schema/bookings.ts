import { sql } from 'drizzle-orm'
import { boolean, check, index, uniqueIndex, integer, numeric, date, pgTable, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core'
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
    // An additional task's request: the paid booking it adds to (trigger check_parent_booking, never changed: rls.ts).
    // Cascade: an account deletion removes the bookings before the requests (bookings.request_id points the other way).
    parentBookingId: uuid('parent_booking_id').references((): AnyPgColumn => bookings.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('requests_status_check', sql`status in ('open','quoted','booked','expired','withdrawn')`),
    index('requests_provider_id_status_idx').on(t.providerId, t.status),
    index('requests_customer_id_idx').on(t.customerId),
    index('requests_service_id_idx').on(t.serviceId),
    index('requests_parent_booking_id_idx').on(t.parentBookingId),
    index('requests_open_answer_by_idx').on(t.answerBy).where(sql`status = 'open'`),
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
    index('quotes_sent_expires_at_idx').on(t.expiresAt).where(sql`status = 'sent'`),
    check('quotes_amount_check', sql`amount >= 0`),
    check('quotes_duration_check', sql`duration_min > 0`),
    check('quotes_version_check', sql`version >= 1`),
    check('quotes_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
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
    // Endings (plan 2d), all set on the owner connection after the domain checked the caller (rls.ts COLUMN_STAFF_ONLY).
    // An additional task: the root booking it adds to (same pair, paid; trigger check_parent_booking, never changed).
    parentBookingId: uuid('parent_booking_id').references((): AnyPgColumn => bookings.id),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    confirmBy: timestamp('confirm_by', { withTimezone: true }),
    confirmRemindersSent: integer('confirm_reminders_sent').notNull().default(0),
    askedDoneAt: timestamp('asked_done_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: text('cancelled_by'),
    lateCancel: boolean('late_cancel').notNull().default(false),
    // the side reported as not turning up
    noShow: text('no_show'),
    noShowReportedAt: timestamp('no_show_reported_at', { withTimezone: true }),
    stoppedAt: timestamp('stopped_at', { withTimezone: true }),
    stoppedBy: text('stopped_by'),
    stopAmount: numeric('stop_amount', { precision: 10, scale: 2 }),
    stopNote: text('stop_note'),
    stopStatedAt: timestamp('stop_stated_at', { withTimezone: true }),
    // the material part of the amount, stated at "Finished" (plan 2e's invoices)
    materialAmount: numeric('material_amount', { precision: 10, scale: 2 }).notNull().default('0'),
  },
  (t) => [
    check('bookings_source_check', sql`source in ('quote','direct')`),
    check('bookings_status_check', sql`status in ('proposed','awaiting-payment','confirmed','expired','declined','withdrawn','finished','completed','disputed','cancelled','stopped','refunded')`),
    check('bookings_counter_by_check', sql`counter_by in ('provider','customer')`),
    check('bookings_pay_by_check', sql`status <> 'awaiting-payment' OR pay_by IS NOT NULL`),
    check('bookings_accepted_at_check', sql`status <> 'awaiting-payment' OR accepted_at IS NOT NULL`),
    index('bookings_provider_id_status_idx').on(t.providerId, t.status),
    index('bookings_start_at_idx').on(t.startAt),
    index('bookings_customer_id_idx').on(t.customerId),
    index('bookings_request_id_idx').on(t.requestId),
    check('bookings_cancelled_by_check', sql`cancelled_by in ('customer','provider')`),
    check('bookings_no_show_check', sql`no_show in ('customer','provider')`),
    check('bookings_stopped_by_check', sql`stopped_by in ('customer','provider')`),
    index('bookings_parent_booking_id_idx').on(t.parentBookingId),
    index('bookings_service_id_idx').on(t.serviceId),
    index('bookings_quote_id_idx').on(t.quoteId),
    index('bookings_proposed_answer_by_idx').on(t.answerBy).where(sql`status = 'proposed'`),
    index('bookings_awaiting_pay_by_idx').on(t.payBy).where(sql`status = 'awaiting-payment'`),
    index('bookings_finished_confirm_by_idx').on(t.confirmBy).where(sql`status = 'finished'`),
    uniqueIndex('bookings_payment_ref_idx').on(t.paymentRef),
    check('bookings_amount_check', sql`amount >= 0`),
    check('bookings_commission_rate_check', sql`commission_rate >= 0 AND commission_rate < 1`),
    check('bookings_stop_amount_check', sql`stop_amount >= 0 AND stop_amount <= amount`),
    check('bookings_material_amount_check', sql`material_amount >= 0 AND material_amount <= amount`),
    check('bookings_duration_check', sql`duration_min > 0`),
    check('bookings_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
  ],
)
