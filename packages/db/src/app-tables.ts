import { pgTable, uuid } from 'drizzle-orm/pg-core'
import { requestAppColumns } from './schema/bookings'
import { serviceAppColumns } from './schema/providers'

/** The services table as the app role may insert into it (no `offerable`: the triggers set it). */
export const serviceAppInsert = pgTable('services', serviceAppColumns())

/** The requests table as the app role may insert into it (no `job_number`: the database numbers the request). */
export const requestAppInsert = pgTable('requests', { id: uuid().primaryKey().defaultRandom(), ...requestAppColumns() })
