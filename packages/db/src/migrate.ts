import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator'
import { db } from './client'
import { applyRls } from './rls'

// Path built with join, not new URL(...): keeps bundlers (next build) from trying to resolve the folder.
/** Applies pending Drizzle migrations, then (idempotently) the row-level-security statements. */
export async function migrate(): Promise<void> {
  await drizzleMigrate(db, { migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '../migrations') })
  await applyRls()
}
