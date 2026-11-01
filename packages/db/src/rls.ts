import { getTableColumns, getTableName, is, sql } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import * as schema from './schema'

// Restricted role every app request runs as. The owner connection bypasses RLS; never FORCE it.
export const APP_ROLE = 'app_user'

const OWN_SERVICE = 'EXISTS (SELECT 1 FROM providers p WHERE p.id = provider_id AND p.owner_id = app_current_user_id())'

// Private table → ownership expression. Every new private table goes here, plus an isolation test.
export const PRIVATE_TABLES: Record<string, string> = {
  users: 'id = app_current_user_id()',
  documents: 'owner_id = app_current_user_id()',
  private_files: 'owner_id = app_current_user_id()',
  notifications: 'user_id = app_current_user_id()',
  // The customer and the provider's owner; the domain enforces who may change what.
  requests: `customer_id = app_current_user_id() OR ${OWN_SERVICE}`,
  quotes: `${OWN_SERVICE} OR EXISTS (SELECT 1 FROM requests r WHERE r.id = request_id AND r.customer_id = app_current_user_id())`,
  bookings: `customer_id = app_current_user_id() OR ${OWN_SERVICE}`,
  // Only the blocker sees a block; is_blocked() answers for both sides.
  blocks: 'blocker_id = app_current_user_id()',
  // Only the customer sees a watch; the provider is told the count by the domain, never the names.
  availability_watches: 'customer_id = app_current_user_id()',
  // A device's push token: the person's own. Moving a token another person held runs on the owner connection.
  push_tokens: 'user_id = app_current_user_id()',
}

// Extra rule on INSERT only (a RESTRICTIVE policy, ANDed with owner_only): who may create a row, and with which ids.
// Every row starts at its first status: later statuses only through APP_STATUS_MOVES (or the owner connection).
export const INSERT_RULES: Record<string, string> = {
  requests: `customer_id = app_current_user_id() AND status = 'open'`,
  // A booking starts as the customer's proposal: accepting (pay_by, accepted_at) and countering (counter_by) are updates.
  bookings: `customer_id = app_current_user_id() AND status = 'proposed' AND pay_by IS NULL AND accepted_at IS NULL AND counter_by IS NULL`,
  // Only the provider's owner quotes, and only on a request addressed to that provider (qualified: requests has provider_id too).
  quotes: `${OWN_SERVICE} AND EXISTS (SELECT 1 FROM requests r WHERE r.id = request_id AND r.provider_id = quotes.provider_id) AND status = 'sent'`,
}

/**
 * The status moves app_user may make, per table, keyed '<from>><to>', with the side that makes it (trigger app_status_guard).
 * Only moves made inside a request transaction belong here; the owner connection (expiry, endings, additional tasks, staff)
 * is not affected. Customer: the row's customer_id (quotes: the request's customer); provider: the owner of its provider_id.
 * Answerer (bookings only): the side whose turn it is, as answerBooking decides it from the old counter_by (NULL or
 * 'customer' = the customer proposed last, so the provider answers; 'provider' = the customer answers).
 */
export const APP_STATUS_MOVES: Record<'requests' | 'quotes' | 'bookings', Record<string, 'customer' | 'provider' | 'answerer'>> = {
  requests: {
    'open>quoted': 'provider',
    'quoted>booked': 'customer',
    'open>withdrawn': 'customer',
    'quoted>withdrawn': 'customer',
    'open>declined': 'provider',
    'quoted>declined': 'provider',
  },
  quotes: { 'sent>superseded': 'provider', 'sent>accepted': 'customer' },
  bookings: {
    'proposed>awaiting-payment': 'answerer',
    'proposed>declined': 'answerer',
    'proposed>withdrawn': 'customer',
    'awaiting-payment>withdrawn': 'customer',
    'awaiting-time>withdrawn': 'customer',
  },
}

const PARTY = `customer_id = app_current_user_id() OR ${OWN_SERVICE}`
// A message's thread, as t: the caller is a party of it.
const IN_MY_THREAD = (extra = 'true') => `EXISTS (SELECT 1 FROM threads t WHERE t.id = messages.thread_id AND (t.customer_id = app_current_user_id() OR EXISTS (SELECT 1 FROM providers p WHERE p.id = t.provider_id AND p.owner_id = app_current_user_id())) AND ${extra})`

// Readable by the parties, insertable under the insert rule, never updated or deleted: app_user gets SELECT and INSERT only.
export const APPEND_ONLY_TABLES: Record<string, { read: string; insert: string }> = {
  // A thread belongs to a request or booking of exactly these two parties (no forged request or booking id).
  threads: {
    read: PARTY,
    insert: `(${PARTY}) AND (request_id IS NULL OR EXISTS (SELECT 1 FROM requests r WHERE r.id = request_id AND r.customer_id = threads.customer_id AND r.provider_id = threads.provider_id))
      AND (booking_id IS NULL OR EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id AND b.customer_id = threads.customer_id AND b.provider_id = threads.provider_id))`,
  },
  messages: {
    read: IN_MY_THREAD(),
    // Cards (quote, acceptance, ...) carry money: the domain writes them on the owner connection, never the app role.
    insert: `kind IN ('text', 'photo') AND sender_id = app_current_user_id() AND ${IN_MY_THREAD('NOT is_blocked(t.customer_id, t.provider_id)')}`,
  },
}

// Columns that never change after insert (a trigger, so it holds for every writer): the parties of a row cannot be reassigned.
export const IMMUTABLE_COLUMNS: Record<string, string[]> = {
  // A quote is final once sent (the booking's price is copied from it): only status and reminder_sent_at change.
  quotes: ['request_id', 'provider_id', 'amount', 'currency', 'scope', 'start_at', 'duration_min', 'proposed_other_time', 'expires_at'],
  bookings: ['customer_id', 'provider_id', 'request_id', 'parent_booking_id'],
  requests: ['customer_id', 'provider_id', 'parent_booking_id'],
}

// Columns app_user may not insert or update, per table: staff write them on the owner connection, the domain through
// the set_provider_* SECURITY DEFINER functions below. Works for private and public-owned tables.
export const COLUMN_STAFF_ONLY: Record<string, string[]> = {
  users: ['staff_role', 'suspended_until', 'suspended_reason'],
  providers: ['status', 'suspended_until', 'slug', 'public_name', 'location', 'stripe_account_id', 'payouts_ready_at'],
  // Rows are created on the owner connection; the app only sets seen_at and dismissed_at.
  notifications: ['kind', 'payload', 'user_id'],
  documents: ['status', 'note', 'reviewed_by', 'reviewed_at'],
  // Money and payment: the price comes from the quote or service (bookings_fill_amount), the rest from the payment code.
  // The app role still reads them; no DTO carries commission_rate or the gateway references. App inserts use bookingAppInsert.
  // The endings (plan 2d) likewise: finishing, cancelling, stopping and disputing run on the owner connection after the
  // domain checked the caller.
  bookings: [
    'amount', 'currency', 'commission_rate', 'paid_at', 'payment_ref', 'checkout_ref', 'released_at',
    'parent_booking_id', 'finished_at', 'confirm_by', 'confirm_reminders_sent', 'asked_done_at', 'completed_at', 'cancelled_at',
    'cancelled_by', 'late_cancel', 'no_show', 'no_show_reported_at', 'stopped_at', 'stopped_by', 'stop_amount', 'stop_note',
    'stop_stated_at', 'material_amount', 'time_proposed_by', 'time_proposed_start_at', 'time_proposed_duration_min', 'time_proposed_on_site', 'time_answer_by',
  ],
  // The cached eligibility: only the offerable triggers below write it.
  services: ['offerable'],
}

/**
 * Booking statuses app_user may neither set nor leave: paid (confirmed) and every ending. Each ending is reached from a paid
 * booking, so the owner connection (the payment code, the endings after the domain checked the caller, staff) moves it.
 */
export const OWNER_ONLY_BOOKING_STATUSES = ['confirmed', 'finished', 'completed', 'disputed', 'cancelled', 'stopped', 'refunded'] as const

/**
 * Private tables app_user may read and write but never delete from. Bookings: a delete would cascade to the chat and the
 * additional tasks and strand held money; only account deletion removes them, on the owner connection.
 */
export const NO_APP_DELETE: string[] = ['bookings']

/**
 * Paid, and every ending where the work was on: such a booking holds the provider's time (busy_times, slotIsHeld) and can
 * take an additional task (check_parent_booking).
 */
export const SLOT_HOLDING_STATUSES = ['confirmed', 'finished', 'disputed', 'stopped', 'completed'] as const

// Suspensions end by their date: a past suspended_until counts as none.
// The one SQL test for it, for a column of `alias` (e.g. 'p' for providers p); used by every query and policy that hides suspended profiles.
export const notSuspended = (alias = ''): string => {
  const c = `${alias ? `${alias}.` : ''}suspended_until`
  return `(${c} IS NULL OR ${c} <= now())`
}
/** The same condition as a SQL fragment for Drizzle queries: the alias is a constant, never input (this file is on the raw-SQL allow-list). */
export const notSuspendedSql = (alias = '') => sql.raw(notSuspended(alias))
const NOT_SUSPENDED = notSuspended()
const LIVE_SERVICE = `EXISTS (SELECT 1 FROM providers p WHERE p.id = provider_id AND p.status = 'published' AND ${NOT_SUSPENDED})`

// Public-owned table → ownership and public-read expressions: readable where publicRead holds (or by the owner), written only by the owner.
export const PUBLIC_OWNED_TABLES: Record<string, { owner: string; publicRead: string }> = {
  providers: { owner: 'owner_id = app_current_user_id()', publicRead: `status = 'published' AND ${NOT_SUSPENDED}` },
  services: { owner: OWN_SERVICE, publicRead: LIVE_SERVICE },
  provider_references: { owner: OWN_SERVICE, publicRead: LIVE_SERVICE },
  // A portfolio photo is written by its owner on the owner's own provider; the person's picture (no provider) by the owner.
  // The picture is public once the owner's provider is live; users is private, so this reads providers only.
  photos: {
    owner: `owner_id = app_current_user_id() AND (provider_id IS NULL OR ${OWN_SERVICE})`,
    publicRead: `${LIVE_SERVICE} OR (kind = 'profile' AND EXISTS (SELECT 1 FROM providers p WHERE p.owner_id = photos.owner_id AND p.status = 'published' AND ${NOT_SUSPENDED}))`,
  },
}

// Readable by app_user where the expression holds, written only on the owner connection (staff, or the domain after it
// checked the caller), which sees everything.
export const PUBLISHED_READ_TABLES: Record<string, string> = {
  pages: 'published',
  page_texts: 'EXISTS (SELECT 1 FROM pages p WHERE p.id = page_id AND p.published)',
  // The two parties of the booking.
  disputes: `EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id AND (b.customer_id = app_current_user_id() OR EXISTS (SELECT 1 FROM providers p WHERE p.id = b.provider_id AND p.owner_id = app_current_user_id())))`,
  // Blind until visible (both written, or the time ran out); hidden ones only for their author.
  reviews: '(NOT hidden AND visible_at IS NOT NULL AND visible_at <= now()) OR author_id = app_current_user_id()',
  // The customer and the provider's owner of an issued invoice (plain ids, no foreign keys: it outlives the accounts).
  invoices: PARTY,
  // A quote's numbered PDF: the same two parties (plain ids, no foreign keys).
  quote_documents: PARTY,
  // KANDO's commission invoice: the provider's owner only (no foreign key: it outlives the account).
  commission_invoices: OWN_SERVICE,
}

// Readable by app_user, written only by staff (owner connection).
export const PUBLIC_REFERENCE_TABLES: string[] = ['countries', 'currencies', 'postcodes', 'categories', 'category_texts', 'translations']

// Tables app requests never touch: all privileges revoked.
export const STAFF_ONLY_TABLES: string[] = ['pending_object_deletes', 'retained_records', 'staff_flags', 'contact_attempts', 'staff_access_log', 'ledger_entries', 'stripe_events', 'invoice_counters', 'translation_requests']

// Tables that exist but are not in the Drizzle schema.
const SYSTEM_TABLES = ['__drizzle_migrations', 'spatial_ref_sys']

// Every policy name any map creates, dropped first so a table can move between the maps.
export const POLICY_NAMES = ['owner_only', 'public_read', 'owner_insert', 'owner_update', 'owner_delete', 'app_insert', 'published_read', 'insert_rule', 'party_read', 'party_insert']

/** Every schema table must be in exactly one map. */
export function classifyTables(): { unclassified: string[]; duplicated: string[] } {
  const maps = [
    Object.keys(PRIVATE_TABLES),
    Object.keys(PUBLIC_OWNED_TABLES),
    Object.keys(APPEND_ONLY_TABLES),
    Object.keys(PUBLISHED_READ_TABLES),
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
    const rule = INSERT_RULES[table]
    const immutable = IMMUTABLE_COLUMNS[table]
    return [
      `GRANT INSERT, UPDATE${NO_APP_DELETE.includes(table) ? '' : ', DELETE'} ON ${t} TO ${APP_ROLE}`,
      ...columnRestrictions(table),
      ...head,
      `CREATE POLICY owner_only ON ${t} TO ${APP_ROLE} USING (${priv}) WITH CHECK (${priv})`,
      ...(rule ? [`CREATE POLICY insert_rule ON ${t} AS RESTRICTIVE FOR INSERT TO ${APP_ROLE} WITH CHECK (${rule})`] : []),
      ...(immutable
        ? [
            `DROP TRIGGER IF EXISTS keep_parties ON ${t}`,
            `CREATE TRIGGER keep_parties BEFORE UPDATE ON ${t} FOR EACH ROW EXECUTE FUNCTION reject_column_change(${immutable.map((c) => `'${c}'`).join(', ')})`,
          ]
        : []),
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
  const published = PUBLISHED_READ_TABLES[table]
  if (published) return [...head, `CREATE POLICY published_read ON ${t} FOR SELECT TO ${APP_ROLE} USING (${published})`]
  const append = APPEND_ONLY_TABLES[table]
  if (append) {
    return [
      `GRANT INSERT ON ${t} TO ${APP_ROLE}`,
      ...head,
      `CREATE POLICY party_read ON ${t} FOR SELECT TO ${APP_ROLE} USING (${append.read})`,
      `CREATE POLICY party_insert ON ${t} FOR INSERT TO ${APP_ROLE} WITH CHECK (${append.insert})`,
    ]
  }
  throw new Error(`rlsStatements: "${table}" is not in PRIVATE_TABLES, PUBLIC_OWNED_TABLES, PUBLISHED_READ_TABLES or APPEND_ONLY_TABLES`)
}

// The only write path to a provider's domain-only columns. SECURITY DEFINER (runs as the table owner, past RLS) but
// each one touches just the caller's own row: owner_id = app_current_user_id() is in the statement itself.
const PROVIDER_FUNCTIONS = [
  `CREATE OR REPLACE FUNCTION set_provider_identity(p_public_name text, p_lng float8, p_lat float8) RETURNS void
    LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      UPDATE providers SET public_name = p_public_name, updated_at = now(),
        location = CASE WHEN p_lng IS NULL OR p_lat IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326) END
      WHERE owner_id = app_current_user_id() $$`,
  // Publishing assigns the slug once (base, base-2, base-3 ...) and keeps it; false: no profile, or suspended
  // (the profile, or the owner: a user suspended before the profile existed; a lift sets suspended_until to NULL).
  `CREATE OR REPLACE FUNCTION set_provider_published(p_published boolean, p_slug_base text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    DECLARE r providers; s text; n int := 1;
    BEGIN
      SELECT * INTO r FROM providers WHERE owner_id = app_current_user_id() FOR UPDATE;
      IF NOT FOUND THEN RETURN false; END IF;
      IF p_published AND (NOT ${notSuspended('r')} OR EXISTS (SELECT 1 FROM users u WHERE u.id = r.owner_id AND NOT ${notSuspended('u')})) THEN
        RETURN false;
      END IF;
      IF p_published AND r.slug IS NULL THEN
        s := p_slug_base;
        -- one publisher per base at a time (the lock lasts to commit), else both pick the same free slug
        PERFORM pg_advisory_xact_lock(hashtext('kando.slug'), hashtext(p_slug_base));
        WHILE EXISTS (SELECT 1 FROM providers WHERE slug = s) LOOP n := n + 1; s := p_slug_base || '-' || n; END LOOP;
        UPDATE providers SET slug = s WHERE id = r.id;
      END IF;
      UPDATE providers SET status = CASE WHEN p_published THEN 'published' ELSE 'draft' END, updated_at = now() WHERE id = r.id;
      RETURN true;
    END $$`,
  `REVOKE ALL ON FUNCTION set_provider_identity(text, float8, float8), set_provider_published(boolean, text) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION set_provider_identity(text, float8, float8), set_provider_published(boolean, text) TO ${APP_ROLE}`,
]

// The offerable rule for the service row `s` (an alias, or NEW in a trigger): priced, and every required document of its
// category approved for the provider's owner. Publish and suspension are checked at read time (offerable_service_ids, search).
const OFFERABLE_RULE = (s: string) => `coalesce(${s}.price_type IS NOT NULL AND (${s}.price_type = 'on-request' OR ${s}.price IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM categories c JOIN providers p ON p.id = ${s}.provider_id, unnest(c.required_documents) AS r(requirement)
          WHERE c.id = ${s}.category_id
            AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.owner_id = p.owner_id AND d.requirement = r.requirement AND d.status = 'approved')
        ), false)`

// services.offerable caches OFFERABLE_RULE; these triggers keep it true on every path (domain, staff, account deletion).
// SECURITY DEFINER: documents are private. VOLATILE (the default), so a recompute that waited for a concurrent writer's
// lock reads that writer's committed change (READ COMMITTED takes a fresh snapshot per statement).
// Concurrency: an existing service row is serialised by its row lock (the document and category triggers UPDATE it). A
// new service row (or one moved to another provider or category) is invisible to those UPDATEs, so it takes the
// owner's advisory lock 'offerable:<owner>' (the document trigger takes it too) and a share lock on its category (the
// category UPDATE holds the row lock). Lock order: document row -> owner lock -> service rows; service row -> owner lock
// only for a row the document trigger cannot see, so no cycle.
const OFFERABLE_TRIGGERS = [
  `CREATE OR REPLACE FUNCTION service_offerable(p_service uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      SELECT coalesce((SELECT ${OFFERABLE_RULE('s')} FROM services s WHERE s.id = p_service), false) $$`,
  `REVOKE ALL ON FUNCTION service_offerable(uuid) FROM PUBLIC`,
  `CREATE OR REPLACE FUNCTION services_set_offerable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    BEGIN
      IF TG_OP = 'INSERT' OR NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN
        PERFORM pg_advisory_xact_lock(hashtext('offerable:' || owner_id)) FROM providers WHERE id = NEW.provider_id;
      END IF;
      IF TG_OP = 'INSERT' OR NEW.category_id IS DISTINCT FROM OLD.category_id THEN
        PERFORM 1 FROM categories WHERE id = NEW.category_id FOR SHARE;
      END IF;
      NEW.offerable := ${OFFERABLE_RULE('NEW')}; -- a fresh snapshot, after any wait above
      RETURN NEW;
    END $$`,
  `DROP TRIGGER IF EXISTS services_set_offerable ON services`,
  `CREATE TRIGGER services_set_offerable BEFORE INSERT OR UPDATE OF category_id, price_type, price, provider_id ON services
    FOR EACH ROW EXECUTE FUNCTION services_set_offerable()`,
  // A document approved, rejected, re-typed or deleted: the services of that owner's providers.
  `CREATE OR REPLACE FUNCTION documents_refresh_offerable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    BEGIN
      -- ponytail: one owner's lock; a document moved between owners (no code path does) would need both, in id order
      PERFORM pg_advisory_xact_lock(hashtext('offerable:' || coalesce(NEW.owner_id, OLD.owner_id)));
      UPDATE services s SET offerable = service_offerable(s.id) FROM providers p
        WHERE p.id = s.provider_id AND p.owner_id IN (OLD.owner_id, NEW.owner_id);
      RETURN NULL;
    END $$`,
  `DROP TRIGGER IF EXISTS documents_refresh_offerable ON documents`,
  `CREATE TRIGGER documents_refresh_offerable AFTER INSERT OR UPDATE OF status, requirement, owner_id OR DELETE ON documents
    FOR EACH ROW EXECUTE FUNCTION documents_refresh_offerable()`,
  // A category's required documents changed: its services.
  `CREATE OR REPLACE FUNCTION categories_refresh_offerable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    BEGIN
      UPDATE services SET offerable = service_offerable(id) WHERE category_id = NEW.id;
      RETURN NULL;
    END $$`,
  `DROP TRIGGER IF EXISTS categories_refresh_offerable ON categories`,
  `CREATE TRIGGER categories_refresh_offerable AFTER UPDATE OF required_documents ON categories
    FOR EACH ROW WHEN (OLD.required_documents IS DISTINCT FROM NEW.required_documents) EXECUTE FUNCTION categories_refresh_offerable()`,
  // Re-sync on every apply: a changed OFFERABLE_RULE, or rows written before the triggers existed, are corrected here.
  `UPDATE services SET offerable = service_offerable(id) WHERE offerable IS DISTINCT FROM service_offerable(id)`,
]

// Eligibility: documents are private (RLS), so the check runs as the table owner, for the provider's owner only.
// Callable by app_user so search and public pages can use their own request transaction. Answers only for a provider
// the caller may see (published and not suspended, or the caller's own); anything else gets an empty answer.
const ELIGIBILITY_FUNCTIONS = [
  `CREATE OR REPLACE FUNCTION offerable_service_ids(p_provider_id uuid) RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
      SELECT s.id FROM services s
      JOIN providers p ON p.id = s.provider_id
      WHERE s.provider_id = p_provider_id AND s.offerable -- OFFERABLE_TRIGGERS keep it
        AND ((p.status = 'published' AND ${notSuspended('p')}) OR p.owner_id = app_current_user_id())
      ORDER BY s.created_at, s.id $$`,
  `CREATE OR REPLACE FUNCTION missing_requirements(p_provider_id uuid, p_service_id uuid) RETURNS text[]
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
      SELECT coalesce(array_agg(r.requirement ORDER BY r.requirement), '{}') FROM services s
      JOIN categories c ON c.id = s.category_id
      JOIN providers p ON p.id = s.provider_id
      CROSS JOIN LATERAL unnest(c.required_documents) AS r(requirement)
      WHERE s.id = p_service_id AND s.provider_id = p_provider_id
        AND ((p.status = 'published' AND ${notSuspended('p')}) OR p.owner_id = app_current_user_id())
        AND NOT EXISTS (
          SELECT 1 FROM documents d WHERE d.owner_id = p.owner_id AND d.requirement = r.requirement AND d.status = 'approved'
        ) $$`,
  // The public "checked documents" line: type keys only (no files, notes or dates), for a published, non-suspended provider.
  // Per type the latest reviewed check decides (a later rejection removes it); pending checks do not count.
  `CREATE OR REPLACE FUNCTION public_checked_documents(p_provider_id uuid) RETURNS text[]
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
      SELECT coalesce(array_agg(l.requirement ORDER BY l.requirement), '{}') FROM (
        SELECT DISTINCT ON (d.requirement) d.requirement, d.status
        FROM documents d JOIN providers p ON p.owner_id = d.owner_id
        WHERE p.id = p_provider_id AND p.status = 'published' AND ${notSuspended('p')} AND d.status IN ('approved', 'rejected')
        ORDER BY d.requirement, d.reviewed_at DESC NULLS LAST, d.created_at DESC, d.id DESC
      ) l WHERE l.status = 'approved' $$`,
  `REVOKE ALL ON FUNCTION offerable_service_ids(uuid), missing_requirements(uuid, uuid), public_checked_documents(uuid) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION offerable_service_ids(uuid), missing_requirements(uuid, uuid), public_checked_documents(uuid) TO ${APP_ROLE}`,
]

// A provider's calendar for everyone: bookings are private (RLS), so this runs as the table owner and returns only
// the time range and a state, for a published, non-suspended provider, in a window of at most 62 days.
// 'pending' = awaiting-payment within its payment window; 'booked' = paid (SLOT_HOLDING_STATUSES).
const HOLDING = `ARRAY[${SLOT_HOLDING_STATUSES.map((s) => `'${s}'`).join(', ')}]::text[]`
const BUSY_FUNCTIONS = [
  `CREATE OR REPLACE FUNCTION busy_times(p_provider uuid, p_from timestamptz, p_to timestamptz)
    RETURNS TABLE (start_at timestamptz, end_at timestamptz, state text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    BEGIN
      IF p_to <= p_from OR p_to - p_from > interval '62 days' THEN RAISE EXCEPTION 'busy_times: range must be 1 to 62 days'; END IF;
      RETURN QUERY
        SELECT b.start_at, b.start_at + b.duration_min * interval '1 minute', CASE WHEN b.status = ANY (${HOLDING}) THEN 'booked' ELSE 'pending' END::text
        FROM bookings b JOIN providers p ON p.id = b.provider_id
        WHERE b.provider_id = p_provider AND (b.status = ANY (${HOLDING}) OR (b.status = 'awaiting-payment' AND b.pay_by > now()))
          AND p.status = 'published' AND ${notSuspended('p')}
          AND b.start_at < p_to AND b.start_at + b.duration_min * interval '1 minute' > p_from
        ORDER BY 1, 2;
    END $$`,
  `REVOKE ALL ON FUNCTION busy_times(uuid, timestamptz, timestamptz) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION busy_times(uuid, timestamptz, timestamptz) TO ${APP_ROLE}`,
  // The public reliability line: the provider's late cancellations plus no-shows that stood (the booking ended cancelled or
  // refunded, not while objected) in the last 12 months. Root bookings only: cancelling a booking also cancels its paid
  // additional tasks by the same rule, and that is one late cancellation, not several. A count only, for a published,
  // non-suspended provider or the caller's own; 0 for anything else.
  `CREATE OR REPLACE FUNCTION provider_reliability(p_provider uuid) RETURNS int
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
      SELECT count(*)::int FROM bookings b JOIN providers p ON p.id = b.provider_id
      WHERE b.provider_id = p_provider AND b.parent_booking_id IS NULL
        AND ((p.status = 'published' AND ${notSuspended('p')}) OR p.owner_id = app_current_user_id())
        AND ((b.cancelled_by = 'provider' AND b.late_cancel AND b.status = 'cancelled' AND b.cancelled_at > now() - interval '12 months')
          OR (b.no_show = 'provider' AND b.status IN ('cancelled', 'refunded') AND b.no_show_reported_at > now() - interval '12 months')) $$`,
  `REVOKE ALL ON FUNCTION provider_reliability(uuid) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION provider_reliability(uuid) TO ${APP_ROLE}`,
]

// Booking guards, for every writer (the owner connection included unless said otherwise). Invoker rights: the inserting
// customer reads the quote and service under RLS, so a quote or service they cannot see counts as foreign.
// bookings_fill_amount, on insert: the price is the quote's, else the service's (an app insert cannot name amount or currency
// at all); the quote must be the booking provider's, on a request of the booking's customer; the service must be the
// provider's; request_id is the quote's request (whatever was supplied). On update quote_id and service_id are frozen:
// only unchanged or NULL (an ON DELETE SET NULL cascade) passes.
const OWNER_ONLY = `ARRAY[${OWNER_ONLY_BOOKING_STATUSES.map((s) => `'${s}'`).join(', ')}]::text[]`
// 'table:from>to' → side, for app_status_guard's CASE (constants from this file, never input).
const APP_STATUS_MOVE_CASES = Object.entries(APP_STATUS_MOVES)
  .flatMap(([t, moves]) => Object.entries(moves).map(([move, side]) => `WHEN '${t}:${move}' THEN '${side}'`))
  .join('\n        ')
const BOOKING_TRIGGERS = [
  `CREATE OR REPLACE FUNCTION bookings_fill_amount() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
    DECLARE q_amount numeric; q_currency text; q_request uuid; s_price numeric; s_currency text;
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        IF NEW.quote_id IS NOT NULL AND NEW.quote_id IS DISTINCT FROM OLD.quote_id THEN RAISE EXCEPTION 'quote_id cannot be changed'; END IF;
        IF NEW.service_id IS NOT NULL AND NEW.service_id IS DISTINCT FROM OLD.service_id THEN RAISE EXCEPTION 'service_id cannot be changed'; END IF;
        RETURN NEW;
      END IF;
      IF NEW.service_id IS NOT NULL THEN
        SELECT price, currency INTO s_price, s_currency FROM services WHERE id = NEW.service_id AND provider_id = NEW.provider_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'bookings: service % does not belong to the provider', NEW.service_id; END IF;
      END IF;
      IF NEW.quote_id IS NOT NULL THEN
        SELECT q.amount, q.currency, q.request_id INTO q_amount, q_currency, q_request FROM quotes q JOIN requests r ON r.id = q.request_id
          WHERE q.id = NEW.quote_id AND q.provider_id = NEW.provider_id AND r.customer_id = NEW.customer_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'bookings: quote % does not belong to this customer and provider', NEW.quote_id; END IF;
      END IF;
      NEW.request_id := q_request;
      IF q_amount IS NOT NULL THEN NEW.amount := q_amount; NEW.currency := q_currency;
      ELSIF s_price IS NOT NULL THEN NEW.amount := s_price; NEW.currency := s_currency;
      END IF;
      RETURN NEW;
    END $$`,
  `DROP TRIGGER IF EXISTS bookings_fill_amount ON bookings`,
  `CREATE TRIGGER bookings_fill_amount BEFORE INSERT OR UPDATE OF quote_id, service_id ON bookings FOR EACH ROW EXECUTE FUNCTION bookings_fill_amount()`,
  // An owner-only status (paid, or an ending) is set, and left, only on the owner connection: an app request can neither
  // move a booking into it (insert or update) nor out of it (that would dodge settlement), nor change any other column of
  // such a booking (its start time decides money: late cancellation, Finished, no-shows). An update that changes nothing passes.
  `CREATE OR REPLACE FUNCTION bookings_guard_status() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
    BEGIN
      IF current_user = '${APP_ROLE}' THEN
        IF (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status) AND NEW.status = ANY (${OWNER_ONLY}) THEN
          RAISE EXCEPTION 'bookings: status % is set by the payment code only', NEW.status;
        END IF;
        IF TG_OP = 'UPDATE' AND OLD.status = ANY (${OWNER_ONLY}) AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
          RAISE EXCEPTION 'bookings: a % booking is changed by the payment code only', OLD.status;
        END IF;
        -- accepting sets pay_by and accepted_at, once, inside the time: payment due by the start, not before the acceptance
        IF TG_OP = 'UPDATE' AND OLD.status = 'proposed' AND NEW.status = 'awaiting-payment' THEN
          IF NOT coalesce(NEW.pay_by <= NEW.start_at AND NEW.accepted_at <= NEW.pay_by AND abs(extract(epoch FROM (NEW.accepted_at - now()))) <= 300, false) THEN
            RAISE EXCEPTION 'bookings: pay_by must lie between accepted_at and start_at, and accepted_at within 5 minutes of now';
          END IF;
        ELSIF TG_OP = 'UPDATE' AND (NEW.pay_by IS DISTINCT FROM OLD.pay_by OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at) THEN
          RAISE EXCEPTION 'bookings: pay_by and accepted_at are set by accepting only';
        END IF;
        -- the proposal (time, place, who answers by when) changes only while it is a proposal: the counter and the answer
        IF TG_OP = 'UPDATE' AND OLD.status <> 'proposed' AND (NEW.answer_by, NEW.counter_by, NEW.start_at, NEW.duration_min, NEW.on_site, NEW.address_street, NEW.address_postcode, NEW.address_city)
            IS DISTINCT FROM (OLD.answer_by, OLD.counter_by, OLD.start_at, OLD.duration_min, OLD.on_site, OLD.address_street, OLD.address_postcode, OLD.address_city) THEN
          RAISE EXCEPTION 'bookings: answer_by, counter_by, start_at, duration_min, on_site and the address change only while proposed';
        END IF;
      END IF;
      RETURN NEW;
    END $$`,
  `DROP TRIGGER IF EXISTS bookings_guard_status ON bookings`,
  `CREATE TRIGGER bookings_guard_status BEFORE INSERT OR UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION bookings_guard_status()`,
  // app_user changes a status only by a move in APP_STATUS_MOVES, from the listed side; a request's answer_by never changes.
  // A proposed booking's proposal (counter_by, time, place, answer_by) changes only as answerBooking's counter: by the
  // answering side, which becomes counter_by. Else a party could flip the turn and then answer its own proposal.
  `CREATE OR REPLACE FUNCTION app_status_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
    DECLARE n jsonb := to_jsonb(NEW); o jsonb := to_jsonb(OLD); side text; answerer text; is_customer boolean; is_provider boolean;
    BEGIN
      IF current_user <> '${APP_ROLE}' THEN RETURN NEW; END IF;
      IF TG_TABLE_NAME = 'requests' AND (n -> 'answer_by', n -> 'revision', n -> 'revised_at') IS DISTINCT FROM (o -> 'answer_by', o -> 'revision', o -> 'revised_at') THEN
        RAISE EXCEPTION 'requests: answer_by, revision and revised_at cannot be changed';
      END IF;
      -- once a quote exists the customer no longer edits the request: changes go through the chat and the provider's revised quote
      IF TG_TABLE_NAME = 'requests' AND OLD.status <> 'open'
          AND (n -> 'start_at', n -> 'duration_min', n -> 'on_site', n -> 'address_street', n -> 'address_postcode', n -> 'address_city', n -> 'note')
            IS DISTINCT FROM (o -> 'start_at', o -> 'duration_min', o -> 'on_site', o -> 'address_street', o -> 'address_postcode', o -> 'address_city', o -> 'note') THEN
        RAISE EXCEPTION 'requests: the time, place and note change only while the request is open';
      END IF;
      is_customer := CASE WHEN TG_TABLE_NAME = 'quotes'
        THEN EXISTS (SELECT 1 FROM requests r WHERE r.id = (n ->> 'request_id')::uuid AND r.customer_id = app_current_user_id())
        ELSE n ->> 'customer_id' = app_current_user_id() END;
      is_provider := EXISTS (SELECT 1 FROM providers p WHERE p.id = (n ->> 'provider_id')::uuid AND p.owner_id = app_current_user_id());
      answerer := CASE WHEN o ->> 'counter_by' = 'provider' THEN 'customer' ELSE 'provider' END; -- as answerBooking
      IF TG_TABLE_NAME = 'bookings' AND OLD.status = 'proposed' AND NEW.status = 'proposed'
          AND (n -> 'counter_by', n -> 'start_at', n -> 'duration_min', n -> 'on_site', n -> 'answer_by')
            IS DISTINCT FROM (o -> 'counter_by', o -> 'start_at', o -> 'duration_min', o -> 'on_site', o -> 'answer_by')
          AND NOT coalesce(n ->> 'counter_by' = answerer AND CASE answerer WHEN 'customer' THEN is_customer ELSE is_provider END, false) THEN
        RAISE EXCEPTION 'bookings: only the answering side counters a proposal, as itself';
      END IF;
      IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
      side := CASE TG_TABLE_NAME || ':' || OLD.status || '>' || NEW.status
        ${APP_STATUS_MOVE_CASES}
      END;
      IF side = 'answerer' THEN side := answerer; END IF;
      IF side IS NULL OR NOT coalesce((side = 'customer' AND is_customer) OR (side = 'provider' AND is_provider), false) THEN
        RAISE EXCEPTION '%: % > % is not a move the app makes (as this party)', TG_TABLE_NAME, OLD.status, NEW.status;
      END IF;
      RETURN NEW;
    END $$`,
  ...Object.keys(APP_STATUS_MOVES).flatMap((t) => [
    `DROP TRIGGER IF EXISTS ${t}_app_status_guard ON ${t}`,
    `CREATE TRIGGER ${t}_app_status_guard BEFORE UPDATE ON ${t} FOR EACH ROW EXECUTE FUNCTION app_status_guard()`,
  ]),
  // A request its customer withdrew or its provider declined takes no accept and no reminder: its sent quote is declined,
  // on every path (domain, timers, staff). SECURITY DEFINER: the customer's app role may not move a quote itself.
  `CREATE OR REPLACE FUNCTION close_request_quotes() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    BEGIN
      UPDATE quotes SET status = 'declined' WHERE request_id = NEW.id AND status = 'sent';
      RETURN NULL;
    END $$`,
  `DROP TRIGGER IF EXISTS requests_close_quotes ON requests`,
  `CREATE TRIGGER requests_close_quotes AFTER UPDATE OF status ON requests FOR EACH ROW
    WHEN (NEW.status IN ('withdrawn', 'declined') AND OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION close_request_quotes()`,
  // A quote-born root booking that ends unagreed (declined, expired, withdrawn) gives the job back: its quote is open again
  // while it is valid (else expired), its request quoted again (never expired: that would count toward requests-ignored).
  // On every path (domain, timers, staff). NEW.updated_at is the injected now of the writing path. The timers' notice
  // (timers.ts, request-reopened) uses the same predicate. An additional task is not reopened: the customer starts a new one.
  // SECURITY DEFINER: the moves are the owner's, so app_status_guard (app role only) lets them pass and the app role
  // never gets booked > quoted or accepted > sent itself.
  `CREATE OR REPLACE FUNCTION reopen_quote_request() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    BEGIN
      UPDATE quotes SET status = CASE WHEN expires_at > NEW.updated_at THEN 'sent' ELSE 'expired' END WHERE id = NEW.quote_id AND status = 'accepted';
      UPDATE requests SET status = 'quoted', updated_at = NEW.updated_at WHERE id = NEW.request_id AND status = 'booked';
      RETURN NULL;
    END $$`,
  `DROP TRIGGER IF EXISTS bookings_reopen_request ON bookings`,
  `CREATE TRIGGER bookings_reopen_request AFTER UPDATE OF status ON bookings FOR EACH ROW
    WHEN (OLD.status IN ('proposed', 'awaiting-time', 'awaiting-payment') AND NEW.status IN ('declined', 'expired', 'withdrawn') AND NEW.quote_id IS NOT NULL AND NEW.parent_booking_id IS NULL)
    EXECUTE FUNCTION reopen_quote_request()`,
  // An additional task (a request or booking naming parent_booking_id) belongs to a root booking of the same customer and
  // provider that is paid and not cancelled or refunded (SLOT_HOLDING_STATUSES). A booking made from an additional task's request names that
  // request's parent (and an ordinary request makes no additional task). Invoker rights: a parent the inserting customer
  // cannot see counts as foreign. Runs after bookings_fill_amount (trigger names sort), so request_id is the quote's.
  // The column never changes after insert (IMMUTABLE_COLUMNS).
  `CREATE OR REPLACE FUNCTION check_parent_booking() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
    BEGIN
      IF NEW.parent_booking_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM bookings b WHERE b.id = NEW.parent_booking_id AND b.customer_id = NEW.customer_id AND b.provider_id = NEW.provider_id
          AND b.parent_booking_id IS NULL AND b.status = ANY (${HOLDING})
      ) THEN
        RAISE EXCEPTION '%: parent booking % does not belong to this customer and provider, or is not paid', TG_TABLE_NAME, NEW.parent_booking_id;
      END IF;
      IF TG_TABLE_NAME = 'bookings' THEN
        IF NEW.request_id IS NOT NULL AND NEW.parent_booking_id IS DISTINCT FROM (SELECT r.parent_booking_id FROM requests r WHERE r.id = NEW.request_id) THEN
          RAISE EXCEPTION 'bookings: parent booking % is not the parent of request %', NEW.parent_booking_id, NEW.request_id;
        END IF;
      END IF;
      RETURN NEW;
    END $$`,
  `DROP TRIGGER IF EXISTS bookings_parent_check ON bookings`,
  `CREATE TRIGGER bookings_parent_check BEFORE INSERT ON bookings FOR EACH ROW EXECUTE FUNCTION check_parent_booking()`,
  `DROP TRIGGER IF EXISTS requests_parent_check ON requests`,
  `CREATE TRIGGER requests_parent_check BEFORE INSERT ON requests FOR EACH ROW EXECUTE FUNCTION check_parent_booking()`,
  // Money rows are never changed or removed (rows or TRUNCATE), not even on the owner connection. The one exception is the
  // test clean-up (cleanupUsers), which sets kando.ledger_cleanup for its own transaction only.
  `CREATE OR REPLACE FUNCTION ledger_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
    BEGIN
      IF coalesce(current_setting('kando.ledger_cleanup', true), '') <> 'on' THEN
        RAISE EXCEPTION 'ledger_entries is append-only: write a new row instead';
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      IF TG_OP = 'TRUNCATE' THEN RETURN NULL; END IF;
      RETURN NEW;
    END $$`,
  `DROP TRIGGER IF EXISTS ledger_append_only ON ledger_entries`,
  `CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION ledger_append_only()`,
  `DROP TRIGGER IF EXISTS ledger_no_truncate ON ledger_entries`,
  `CREATE TRIGGER ledger_no_truncate BEFORE TRUNCATE ON ledger_entries FOR EACH STATEMENT EXECUTE FUNCTION ledger_append_only()`,
]

// The rate-limit log is owner-only now; the definer function that pruned it for app_user is gone.
const TRANSLATION_FUNCTIONS = ['DROP FUNCTION IF EXISTS prune_translation_requests()']

// Blocks are private to the blocker, so the check that must see both directions runs as the table owner. Returns a boolean only,
// and only answers for a caller who is one of the two (anyone else, and the owner connection without app.user_id, gets false).
const BLOCK_FUNCTIONS = [
  `CREATE OR REPLACE FUNCTION is_blocked(p_a text, p_b text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
      SELECT coalesce(app_current_user_id() IN (p_a, p_b), false) AND EXISTS (SELECT 1 FROM blocks WHERE (blocker_id = p_a AND blocked_id = p_b) OR (blocker_id = p_b AND blocked_id = p_a)) $$`,
  // The provider's owner by provider id: a draft or suspended provider is invisible to the customer under RLS, so the policy cannot look the owner up itself.
  `CREATE OR REPLACE FUNCTION is_blocked(p_user text, p_provider uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
      SELECT is_blocked(p_user, (SELECT owner_id FROM providers WHERE id = p_provider)) $$`,
  `REVOKE ALL ON FUNCTION is_blocked(text, text), is_blocked(text, uuid) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION is_blocked(text, text), is_blocked(text, uuid) TO ${APP_ROLE}`,
]

/** Idempotent SQL: app role, grants, and the policies of the given tables (default: every policy-bearing table). */
export function rlsStatements(
  tables: string[] = [...Object.keys(PRIVATE_TABLES), ...Object.keys(PUBLIC_OWNED_TABLES), ...Object.keys(PUBLISHED_READ_TABLES), ...Object.keys(APPEND_ONLY_TABLES)],
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
    `CREATE OR REPLACE FUNCTION reject_column_change() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE c text;
      BEGIN
        FOREACH c IN ARRAY TG_ARGV LOOP
          IF to_jsonb(NEW) -> c IS DISTINCT FROM to_jsonb(OLD) -> c THEN RAISE EXCEPTION '% cannot be changed', c; END IF;
        END LOOP;
        RETURN NEW;
      END $$`,
    ...BLOCK_FUNCTIONS, // before the policies that call it
    ...policies,
    ...PROVIDER_FUNCTIONS,
    ...OFFERABLE_TRIGGERS,
    ...ELIGIBILITY_FUNCTIONS,
    ...BUSY_FUNCTIONS,
    ...TRANSLATION_FUNCTIONS,
    ...BOOKING_TRIGGERS,
  ]
}

/** All statements in one transaction: a failure leaves the previous grants and policies untouched (the parameter is for the test). */
export async function applyRls(statements: string[] = rlsStatements()): Promise<void> {
  const { db } = await import('./client')
  await db.transaction(async (tx) => {
    for (const statement of statements) await tx.execute(sql.raw(statement))
  })
}
