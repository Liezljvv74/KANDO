import { getTableColumns, getTableName, is, sql } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import * as schema from './schema'

// Restricted role every app request runs as. The owner connection bypasses RLS; never FORCE it.
export const APP_ROLE = 'app_user'

// Private table → ownership expression. Every new private table goes here, plus an isolation test.
export const PRIVATE_TABLES: Record<string, string> = {
  users: 'id = app_current_user_id()',
  documents: 'owner_id = app_current_user_id()',
}

// Columns app_user may not insert or update, per table: staff write them on the owner connection, the domain through
// the set_provider_* SECURITY DEFINER functions below. Works for private and public-owned tables.
export const COLUMN_STAFF_ONLY: Record<string, string[]> = {
  users: ['staff_role', 'suspended_until', 'suspended_reason'],
  providers: ['status', 'suspended', 'slug', 'public_name', 'location'],
  documents: ['status', 'note', 'reviewed_by', 'reviewed_at'],
}

const OWN_SERVICE = 'EXISTS (SELECT 1 FROM providers p WHERE p.id = provider_id AND p.owner_id = app_current_user_id())'
const LIVE_SERVICE = "EXISTS (SELECT 1 FROM providers p WHERE p.id = provider_id AND p.status = 'published' AND p.suspended = false)"

// Public-owned table → ownership and public-read expressions: readable where publicRead holds (or by the owner), written only by the owner.
export const PUBLIC_OWNED_TABLES: Record<string, { owner: string; publicRead: string }> = {
  providers: { owner: 'owner_id = app_current_user_id()', publicRead: "status = 'published' AND suspended = false" },
  services: { owner: OWN_SERVICE, publicRead: LIVE_SERVICE },
  provider_references: { owner: OWN_SERVICE, publicRead: LIVE_SERVICE },
}

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

// A table-level grant cannot be narrowed by a column revoke: drop it and grant the allowed columns.
function columnRestrictions(table: string): string[] {
  const blocked = COLUMN_STAFF_ONLY[table]
  if (!blocked) return []
  const t = (Object.values(schema) as unknown[]).find((x) => is(x, PgTable) && getTableName(x as PgTable) === table)
  const allowed = Object.values(getTableColumns(t as PgTable))
    .map((c) => c.name)
    .filter((n) => !blocked.includes(n))
    .map((n) => `"${n}"`)
    .join(', ')
  return [
    `REVOKE INSERT, UPDATE ON "${table}" FROM ${APP_ROLE}`,
    `GRANT INSERT (${allowed}), UPDATE (${allowed}) ON "${table}" TO ${APP_ROLE}`,
  ]
}

function policyStatements(table: string): string[] {
  const t = `"${table}"`
  const drops = POLICY_NAMES.map((name) => `DROP POLICY IF EXISTS ${name} ON ${t}`)
  const head = [`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`, ...drops]
  const priv = PRIVATE_TABLES[table]
  if (priv) {
    return [
      `GRANT INSERT, UPDATE, DELETE ON ${t} TO ${APP_ROLE}`,
      ...columnRestrictions(table),
      ...head,
      `CREATE POLICY owner_only ON ${t} TO ${APP_ROLE} USING (${priv}) WITH CHECK (${priv})`,
    ]
  }
  const pub = PUBLIC_OWNED_TABLES[table]
  if (pub) {
    const { owner, publicRead } = pub
    return [
      `GRANT INSERT, UPDATE, DELETE ON ${t} TO ${APP_ROLE}`,
      ...columnRestrictions(table),
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

// The only write path to a provider's domain-only columns. SECURITY DEFINER (runs as the table owner, past RLS) but
// each one touches just the caller's own row: owner_id = app_current_user_id() is in the statement itself.
const PROVIDER_FUNCTIONS = [
  `CREATE OR REPLACE FUNCTION set_provider_identity(p_public_name text, p_lng float8, p_lat float8) RETURNS void
    LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      UPDATE providers SET public_name = p_public_name, updated_at = now(),
        location = CASE WHEN p_lng IS NULL OR p_lat IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326) END
      WHERE owner_id = app_current_user_id() $$`,
  // Publishing assigns the slug once (base, base-2, base-3 ...) and keeps it; false: no profile, or suspended.
  `CREATE OR REPLACE FUNCTION set_provider_published(p_published boolean, p_slug_base text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    DECLARE r providers; s text; n int := 1;
    BEGIN
      SELECT * INTO r FROM providers WHERE owner_id = app_current_user_id() FOR UPDATE;
      IF NOT FOUND THEN RETURN false; END IF;
      IF p_published AND r.suspended THEN RETURN false; END IF;
      IF p_published AND r.slug IS NULL THEN
        s := p_slug_base;
        WHILE EXISTS (SELECT 1 FROM providers WHERE slug = s) LOOP n := n + 1; s := p_slug_base || '-' || n; END LOOP;
        UPDATE providers SET slug = s WHERE id = r.id;
      END IF;
      UPDATE providers SET status = CASE WHEN p_published THEN 'published' ELSE 'draft' END, updated_at = now() WHERE id = r.id;
      RETURN true;
    END $$`,
  `REVOKE ALL ON FUNCTION set_provider_identity(text, float8, float8), set_provider_published(boolean, text) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION set_provider_identity(text, float8, float8), set_provider_published(boolean, text) TO ${APP_ROLE}`,
]

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
    ...PROVIDER_FUNCTIONS,
  ]
}

export async function applyRls(): Promise<void> {
  const { db } = await import('./client')
  for (const statement of rlsStatements()) await db.execute(sql.raw(statement))
}
