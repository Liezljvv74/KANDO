import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema'

type Db = NodePgDatabase<typeof schema>

function connectionString(): string {
  // Under vitest always the test database, whatever NODE_ENV says.
  const test = process.env.NODE_ENV === 'test' || !!process.env.VITEST
  const url = test
    ? (process.env.DATABASE_URL_TEST ?? 'postgres://postgres:postgres@localhost:5433/kando')
    : process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return url
}

// Created on first use, so importing this module (a Next.js build) opens nothing and needs no env.
let _pool: pg.Pool | undefined
let _db: Db | undefined
const lazy = <T extends object>(get: () => T): T =>
  new Proxy({} as T, {
    get(_t, prop) {
      const target = get()
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
    // drizzle checks `client instanceof Pool` to give a transaction its own connection; without this a
    // transaction would run its statements on whichever pooled connection is free (RLS context could leak).
    getPrototypeOf: () => Object.getPrototypeOf(get()),
  })

export const pool: pg.Pool = lazy(() => (_pool ??= new pg.Pool({ connectionString: connectionString() })))
export const db: Db = lazy(() => (_db ??= drizzle(pool, { schema })))
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
