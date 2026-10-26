import { expect, it } from 'vitest'
import { asUser, db } from '@kando/db'
import { sql } from 'drizzle-orm'

it('inside a request transaction the owner connection `db` is a different connection (not app_user)', async () => {
  const seen = await asUser('someone', async (tx) => {
    const inTx = (await tx.execute<{ u: string }>(sql`SELECT current_user AS u`)).rows[0]!.u
    const owner = (await db.execute<{ u: string }>(sql`SELECT current_user AS u`)).rows[0]!.u
    return { inTx, owner }
  })
  expect(seen.inTx).toBe('app_user')
  expect(seen.owner).not.toBe('app_user')
})

it('two interleaved requests keep their own user id and role', async () => {
  let release!: () => void
  const barrier = new Promise<void>((r) => (release = r))
  let arrived = 0
  const run = (id: string) =>
    asUser(id, async (tx) => {
      if (++arrived === 2) release()
      await barrier // both transactions are open and have set their id before either reads it
      return (await tx.execute<{ u: string; r: string }>(sql`SELECT current_setting('app.user_id', true) AS u, current_user AS r`)).rows[0]!
    })
  const [a, b] = await Promise.all([run('a'), run('b')])
  expect(a).toEqual({ u: 'a', r: 'app_user' })
  expect(b).toEqual({ u: 'b', r: 'app_user' })
})
