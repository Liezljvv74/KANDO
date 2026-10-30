import { expect, it } from 'vitest'
import { APP_POOL_MAX, OWNER_POOL_MAX, POOL_IDLE_MS, asUser, db, pool } from '@kando/db'
import { appPool } from '@kando/db/src/client'
import { sql } from 'drizzle-orm'

it('an idle-client error is logged, not thrown', () => {
  expect(() => pool.emit('error', new Error('gone'))).not.toThrow()
  expect(() => appPool.emit('error', new Error('gone'))).not.toThrow()
})

it('the pools are bounded', () => {
  expect(pool.options.max).toBe(OWNER_POOL_MAX)
  expect(appPool.options.max).toBe(APP_POOL_MAX)
  expect(appPool.options.idleTimeoutMillis).toBe(POOL_IDLE_MS)
})

it('request transactions beyond the pool size that use the owner connection all finish', { timeout: 5_000 }, async () => {
  await Promise.all(
    Array.from({ length: APP_POOL_MAX + 5 }, () =>
      asUser(null, async () => {
        await new Promise((r) => setTimeout(r, 50))
        await db.execute(sql`SELECT 1`)
      }),
    ),
  )
})
