import { sql } from 'drizzle-orm'
import { APP_ROLE } from './rls'
import { appDb, type Tx } from './client'

/** Runs fn in a transaction as app_user with app.user_id set (null: anonymous, matches no owned rows). */
export function asUser<T>(userId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return appDb.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL ROLE ${APP_ROLE}`))
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId ?? ''}, true)`)
    return fn(tx)
  })
}
