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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    check('providers_type_check', sql`type in ('private','business')`),
    check('providers_status_check', sql`status in ('draft','published')`),
    check('providers_radius_check', sql`service_radius_km between 1 and 200`),
    check(
      'providers_legal_status_check',
      sql`legal_status in ('private','kleinunternehmer','business')`,
    ),
  ],
)

export const services = pgTable(
  'services',
  {
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
  },
  (t) => [
    check('services_price_type_check', sql`price_type in ('fixed','hourly','from','on-request')`),
    index('services_provider_id_idx').on(t.providerId),
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
