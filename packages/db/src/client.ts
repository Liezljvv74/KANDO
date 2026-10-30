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

export const APP_POOL_MAX = 10
// ponytail: `settle` holds two owner connections at once (settle.ts:33), so more than OWNER_POOL_MAX / 2
// settlements in parallel on one instance can still wait; the cron settles one at a time.
export const OWNER_POOL_MAX = 10
export const POOL_IDLE_MS = 5_000

// max bounds the connections per instance; idleTimeoutMillis returns idle ones early; connectionTimeoutMillis makes a
// request that cannot get a connection fail after 10 s; the error handler stops an idle client dropped by the server
// (Neon does this) from emitting an unhandled 'error' that kills the process.
function makePool(max: number): pg.Pool {
  const p = new pg.Pool({ connectionString: connectionString(), max, idleTimeoutMillis: POOL_IDLE_MS, connectionTimeoutMillis: 10_000 })
  p.on('error', (e) => console.error('[db] idle client error', e.message))
  return p
}

let _appPool: pg.Pool | undefined
let _appDb: Db | undefined
export const pool: pg.Pool = lazy(() => (_pool ??= makePool(OWNER_POOL_MAX)))
export const db: Db = lazy(() => (_db ??= drizzle(pool, { schema })))
// Request transactions only (asUser), so owner work inside one never waits for a connection a request holds.
export const appPool: pg.Pool = lazy(() => (_appPool ??= makePool(APP_POOL_MAX)))
export const appDb: Db = lazy(() => (_appDb ??= drizzle(appPool, { schema })))
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
