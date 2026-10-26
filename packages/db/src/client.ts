import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema'

// Under vitest always the test database, whatever NODE_ENV says.
const test = process.env.NODE_ENV === 'test' || !!process.env.VITEST
const url = test
  ? (process.env.DATABASE_URL_TEST ?? 'postgres://postgres:postgres@localhost:5433/kando')
  : process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

export const pool = new pg.Pool({ connectionString: url })
export const db = drizzle(pool, { schema })
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
