import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { categories, point } from './reference'
import { users } from './users'

// status, suspended_until, slug, public_name and location are written by the domain (set_provider_* SQL functions)
// or staff only: see COLUMN_STAFF_ONLY in rls.ts. type is NULL on a draft; the picture is the owner's profile photo.
export const providers = pgTable(
  'providers',
  {
    id: uuid().primaryKey().defaultRandom(),
    ownerId: text('owner_id')
      .notNull()
      .unique()
      .references(() => users.id),
    type: text(),
    businessName: text('business_name'),
    publicName: text('public_name'),
    slug: text().unique(),
    bio: text(),
    strengths: text(),
    skills: text()
      .array()
      .notNull()
      .default(sql`'{}'`),
    experience: text(),
    country: text().notNull().default('DE'),
    basePostcode: text('base_postcode'),
    location: point(),
    serviceRadiusKm: integer('service_radius_km').notNull().default(25),
    worksRemotely: boolean('works_remotely').notNull().default(false),
    impressum: text(),
    status: text().notNull().default('draft'),
    suspendedUntil: timestamp('suspended_until', { withTimezone: true }),
    legalStatus: text('legal_status'),
    vatId: text('vat_id'),
    // Invoicing (plan 2e): the provider's tax number, and when they agreed that the platform issues invoices in their name.
    taxNumber: text('tax_number'),
    invoiceConsentAt: timestamp('invoice_consent_at', { withTimezone: true }),
    // Staff-only (rls.ts): the Stripe connected account and when its payout set-up was complete.
    stripeAccountId: text('stripe_account_id').unique(),
    payoutsReadyAt: timestamp('payouts_ready_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('providers_location_gist').using('gist', sql`(${t.location}::geography)`),
    index('providers_suspended_until_idx').on(t.suspendedUntil).where(sql`suspended_until IS NOT NULL`),
    check('providers_type_check', sql`type in ('private','business')`),
    check('providers_status_check', sql`status in ('draft','published')`),
    check('providers_radius_check', sql`service_radius_km between 1 and 200`),
    check(
      'providers_legal_status_check',
      sql`legal_status in ('private','kleinunternehmer','business')`,
    ),
  ],
)

/**
 * The service columns the app role writes; `offerable` is trigger-only (rls.ts COLUMN_STAFF_ONLY.services). A Drizzle
 * insert names every column of its table, so app inserts go through `serviceAppInsert` (../app-tables.ts), this shape.
 */
export const serviceAppColumns = () => ({
  id: uuid().primaryKey().defaultRandom(),
  providerId: uuid('provider_id')
    .notNull()
    .references(() => providers.id, { onDelete: 'cascade' }),
  categoryId: uuid('category_id')
    .notNull()
    .references(() => categories.id),
  title: text().notNull(),
  description: text(),
  priceType: text('price_type'), // NULL until set: a service may exist with a category alone, never offerable
  price: numeric({ precision: 10, scale: 2 }),
  currency: text().notNull().default('EUR'),
  sort: integer().notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const services = pgTable(
  'services',
  {
    ...serviceAppColumns(),
    // Kept up to date by triggers (rls.ts): priced and every required document of the category approved. Publish and suspension are checked at read time.
    offerable: boolean().notNull().default(false),
  },
  (t) => [
    check('services_price_type_check', sql`price_type in ('fixed','hourly','from','on-request')`),
    index('services_provider_id_idx').on(t.providerId),
    index('services_category_id_idx').on(t.categoryId),
    check('services_price_check', sql`price >= 0`),
    check('services_currency_check', sql`currency ~ '^[A-Z]{3}$'`),
  ],
)

export const providerReferences = pgTable(
  'provider_references',
  {
    id: uuid().primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'cascade' }),
    clientName: text('client_name').notNull(),
    description: text().notNull(),
    year: integer(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('provider_references_provider_id_idx').on(t.providerId)],
)
