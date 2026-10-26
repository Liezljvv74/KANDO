import { fileURLToPath } from 'node:url'
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator'
import { db } from './client'
import { applyRls } from './rls'

/** Applies pending Drizzle migrations, then (idempotently) the row-level-security statements. */
export async function migrate(): Promise<void> {
  await drizzleMigrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) })
  await applyRls()
}
