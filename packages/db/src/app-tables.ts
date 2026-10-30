import { pgTable } from 'drizzle-orm/pg-core'
import { bookingAppColumns } from './schema/bookings'
import { serviceAppColumns } from './schema/providers'

/** The bookings table as the app role may insert into it (no money columns); outside ./schema, so drizzle-kit never sees it. */
export const bookingAppInsert = pgTable('bookings', bookingAppColumns())
/** The services table as the app role may insert into it (no `offerable`: the triggers set it). */
export const serviceAppInsert = pgTable('services', serviceAppColumns())
