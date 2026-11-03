import { pgTable } from 'drizzle-orm/pg-core'
import { serviceAppColumns } from './schema/providers'

/** The services table as the app role may insert into it (no `offerable`: the triggers set it). */
export const serviceAppInsert = pgTable('services', serviceAppColumns())
