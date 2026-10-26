import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema'

const test = process.env.NODE_ENV === 'test'
const url = test
  ? (process.env.DATABASE_URL_TEST ?? 'postgres://postgres:postgres@localhost:5433/kando')
  : process.env.DATABASE_URL

export const pool = new pg.Pool({ connectionString: url })
export const db = drizzle(pool, { schema })
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
