import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator'
import { db } from './client'
import { applyRls } from './rls'

// Path built with join, not new URL(...): keeps bundlers (next build) from trying to resolve the folder.
/**
 * Applies pending Drizzle migrations, then (idempotently, in one transaction) the row-level-security statements.
 * The migrator runs ALL pending files in one transaction, so a migration cannot use CREATE INDEX CONCURRENTLY, and
 * every ADD CONSTRAINT ... CHECK holds its lock until the whole run commits. Rule: widen an existing status or kind
 * CHECK as DROP CONSTRAINT; ADD CONSTRAINT ... CHECK (...) NOT VALID with no VALIDATE (old rows satisfy the narrower
 * list, so no scan is needed). A new constraint on a table with real data, or a concurrent index, needs a step
 * outside the migrator's transaction (not built: production holds no data yet).
 */
export async function migrate(): Promise<void> {
  await drizzleMigrate(db, { migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '../migrations') })
  await applyRls()
}
