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
