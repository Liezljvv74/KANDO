import { getTableName, is, sql } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import * as schema from './schema'

// Restricted role every app request runs as. The owner connection bypasses RLS; never FORCE it.
export const APP_ROLE = 'app_user'

// Private table → ownership expression. Every new private table goes here, plus an isolation test.
export const PRIVATE_TABLES: Record<string, string> = {}

// Public-owned table → ownership and public-read expressions: readable where publicRead holds (or by the owner), written only by the owner.
export const PUBLIC_OWNED_TABLES: Record<string, { owner: string; publicRead: string }> = {}

// Readable by everyone, insertable by any app request, never updated or deleted by app_user.
export const INSERT_ONLY_TABLES: string[] = []

// Readable by app_user, written only by staff (owner connection).
export const PUBLIC_REFERENCE_TABLES: string[] = ['countries', 'currencies', 'postcodes', 'categories', 'category_texts']

// Tables app requests never touch: all privileges revoked.
export const STAFF_ONLY_TABLES: string[] = []

// Tables that exist but are not in the Drizzle schema.
const SYSTEM_TABLES = ['__drizzle_migrations', 'spatial_ref_sys']

// Every policy name any map creates, dropped first so a table can move between the maps.
export const POLICY_NAMES = ['owner_only', 'public_read', 'owner_insert', 'owner_update', 'owner_delete', 'app_insert']

/** Every schema table must be in exactly one map. */
export function classifyTables(): { unclassified: string[]; duplicated: string[] } {
  const maps = [
    Object.keys(PRIVATE_TABLES),
    Object.keys(PUBLIC_OWNED_TABLES),
    INSERT_ONLY_TABLES,
    PUBLIC_REFERENCE_TABLES,
    STAFF_ONLY_TABLES,
  ]
  const names = (Object.values(schema) as unknown[])
    .filter((t) => is(t, PgTable))
    .map((t) => getTableName(t as PgTable))
    .filter((n) => !SYSTEM_TABLES.includes(n))
  const count = (n: string) => maps.filter((m) => m.includes(n)).length
  return { unclassified: names.filter((n) => count(n) === 0), duplicated: names.filter((n) => count(n) > 1) }
}

function policyStatements(table: string): string[] {
  const t = `"${table}"`
  const drops = POLICY_NAMES.map((name) => `DROP POLICY IF EXISTS ${name} ON ${t}`)
  const head = [`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`, ...drops]
  const priv = PRIVATE_TABLES[table]
  if (priv) {
    return [
      `GRANT INSERT, UPDATE, DELETE ON ${t} TO ${APP_ROLE}`,
      ...head,
      `CREATE POLICY owner_only ON ${t} TO ${APP_ROLE} USING (${priv}) WITH CHECK (${priv})`,
    ]
  }
  const pub = PUBLIC_OWNED_TABLES[table]
  if (pub) {
    const { owner, publicRead } = pub
    return [
      `GRANT INSERT, UPDATE, DELETE ON ${t} TO ${APP_ROLE}`,
      ...head,
      `CREATE POLICY public_read ON ${t} FOR SELECT TO ${APP_ROLE} USING ((${publicRead}) OR (${owner}))`,
      `CREATE POLICY owner_insert ON ${t} FOR INSERT TO ${APP_ROLE} WITH CHECK (${owner})`,
      `CREATE POLICY owner_update ON ${t} FOR UPDATE TO ${APP_ROLE} USING (${owner}) WITH CHECK (${owner})`,
      `CREATE POLICY owner_delete ON ${t} FOR DELETE TO ${APP_ROLE} USING (${owner})`,
    ]
  }
  if (INSERT_ONLY_TABLES.includes(table)) {
    return [
      `GRANT INSERT ON ${t} TO ${APP_ROLE}`,
      ...head,
      `CREATE POLICY public_read ON ${t} FOR SELECT TO ${APP_ROLE} USING (true)`,
      `CREATE POLICY app_insert ON ${t} FOR INSERT TO ${APP_ROLE} WITH CHECK (true)`,
    ]
  }
  throw new Error(`rlsStatements: "${table}" is not in PRIVATE_TABLES, PUBLIC_OWNED_TABLES or INSERT_ONLY_TABLES`)
}

/** Idempotent SQL: app role, grants, and the policies of the given tables (default: every policy-bearing table). */
export function rlsStatements(
  tables: string[] = [...Object.keys(PRIVATE_TABLES), ...Object.keys(PUBLIC_OWNED_TABLES), ...INSERT_ONLY_TABLES],
): string[] {
  const dup = classifyTables().duplicated
  if (dup.length) throw new Error(`rlsStatements: ${dup.join(', ')} in more than one map`)
  const policies = tables.flatMap(policyStatements) // throws before any SQL is returned
  return [
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN CREATE ROLE ${APP_ROLE} NOLOGIN; END IF;
    END $$`,
    `GRANT ${APP_ROLE} TO CURRENT_USER`,
    // nullif: after a SET LOCAL ends the setting reads as '' (not NULL) on that pooled connection.
    `CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$`,
    `GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`,
    // Read-only by default (revoke first so earlier, wider grants do not linger); writes only where listed above.
    `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM ${APP_ROLE}`,
    `GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`,
    `DO $$ DECLARE t text; BEGIN
      FOREACH t IN ARRAY ARRAY[${STAFF_ONLY_TABLES.map((t) => `'${t}'`).join(',')}]::text[] LOOP
        IF to_regclass(format('public.%I', t)) IS NOT NULL THEN EXECUTE format('REVOKE ALL ON public.%I FROM ${APP_ROLE}', t); END IF;
      END LOOP;
    END $$`,
    ...policies,
  ]
}

export async function applyRls(): Promise<void> {
  const { db } = await import('./client')
  for (const statement of rlsStatements()) await db.execute(sql.raw(statement))
}
