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
export const INSERT_RULES: Record<string, string> = {
  requests: 'customer_id = app_current_user_id()',
  bookings: 'customer_id = app_current_user_id()',
  // Only the provider's owner quotes, and only on a request addressed to that provider (qualified: requests has provider_id too).
  quotes: `${OWN_SERVICE} AND EXISTS (SELECT 1 FROM requests r WHERE r.id = request_id AND r.provider_id = quotes.provider_id)`,
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
  quotes: ['request_id', 'provider_id', 'amount', 'currency', 'scope', 'start_at', 'duration_min', 'expires_at'],
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
    'stop_stated_at', 'material_amount',
  ],
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

// Readable by everyone, insertable by any app request, never updated or deleted by app_user.
export const INSERT_ONLY_TABLES: string[] = ['translations', 'translation_requests']

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
  // KANDO's commission invoice: the provider's owner only (no foreign key: it outlives the account).
  commission_invoices: OWN_SERVICE,
}

// Readable by app_user, written only by staff (owner connection).
export const PUBLIC_REFERENCE_TABLES: string[] = ['countries', 'currencies', 'postcodes', 'categories', 'category_texts']

// Tables app requests never touch: all privileges revoked.
export const STAFF_ONLY_TABLES: string[] = ['pending_object_deletes', 'retained_records', 'staff_flags', 'contact_attempts', 'staff_access_log', 'ledger_entries', 'stripe_events', 'invoice_counters']

// Tables that exist but are not in the Drizzle schema.
const SYSTEM_TABLES = ['__drizzle_migrations', 'spatial_ref_sys']

// Every policy name any map creates, dropped first so a table can move between the maps.
export const POLICY_NAMES = ['owner_only', 'public_read', 'owner_insert', 'owner_update', 'owner_delete', 'app_insert', 'published_read', 'insert_rule', 'party_read', 'party_insert']

/** Every schema table must be in exactly one map. */
export function classifyTables(): { unclassified: string[]; duplicated: string[] } {
  const maps = [
    Object.keys(PRIVATE_TABLES),
    Object.keys(PUBLIC_OWNED_TABLES),
    INSERT_ONLY_TABLES,
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
  if (INSERT_ONLY_TABLES.includes(table)) {
    return [
      `GRANT INSERT ON ${t} TO ${APP_ROLE}`,
      ...head,
      `CREATE POLICY public_read ON ${t} FOR SELECT TO ${APP_ROLE} USING (true)`,
      `CREATE POLICY app_insert ON ${t} FOR INSERT TO ${APP_ROLE} WITH CHECK (true)`,
    ]
  }
  throw new Error(`rlsStatements: "${table}" is not in PRIVATE_TABLES, PUBLIC_OWNED_TABLES, PUBLISHED_READ_TABLES, INSERT_ONLY_TABLES or APPEND_ONLY_TABLES`)
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
        WHILE EXISTS (SELECT 1 FROM providers WHERE slug = s) LOOP n := n + 1; s := p_slug_base || '-' || n; END LOOP;
        UPDATE providers SET slug = s WHERE id = r.id;
      END IF;
      UPDATE providers SET status = CASE WHEN p_published THEN 'published' ELSE 'draft' END, updated_at = now() WHERE id = r.id;
      RETURN true;
    END $$`,
  `REVOKE ALL ON FUNCTION set_provider_identity(text, float8, float8), set_provider_published(boolean, text) FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION set_provider_identity(text, float8, float8), set_provider_published(boolean, text) TO ${APP_ROLE}`,
]

// Eligibility: documents are private (RLS), so the check runs as the table owner, for the provider's owner only.
// Callable by app_user so search and public pages can use their own request transaction. Answers only for a provider
// the caller may see (published and not suspended, or the caller's own); anything else gets an empty answer.
const ELIGIBILITY_FUNCTIONS = [
  `CREATE OR REPLACE FUNCTION offerable_service_ids(p_provider_id uuid) RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
      SELECT s.id FROM services s
      JOIN categories c ON c.id = s.category_id
      JOIN providers p ON p.id = s.provider_id
      WHERE s.provider_id = p_provider_id
        AND s.price_type IS NOT NULL AND (s.price_type = 'on-request' OR s.price IS NOT NULL)
        AND ((p.status = 'published' AND ${notSuspended('p')}) OR p.owner_id = app_current_user_id())
        AND NOT EXISTS (
          SELECT 1 FROM unnest(c.required_documents) AS r(requirement)
          WHERE NOT EXISTS (
            SELECT 1 FROM documents d WHERE d.owner_id = p.owner_id AND d.requirement = r.requirement AND d.status = 'approved'
          )
        )
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
      END IF;
      RETURN NEW;
    END $$`,
  `DROP TRIGGER IF EXISTS bookings_guard_status ON bookings`,
  `CREATE TRIGGER bookings_guard_status BEFORE INSERT OR UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION bookings_guard_status()`,
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

// app_user has no DELETE on the rate-limit log, so the 24-hour clean-up runs as the table owner through this function.
const TRANSLATION_FUNCTIONS = [
  `CREATE OR REPLACE FUNCTION prune_translation_requests() RETURNS void
    LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      DELETE FROM translation_requests WHERE created_at < now() - interval '24 hours' $$`,
  `REVOKE ALL ON FUNCTION prune_translation_requests() FROM PUBLIC`,
  `GRANT EXECUTE ON FUNCTION prune_translation_requests() TO ${APP_ROLE}`,
]

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
  tables: string[] = [...Object.keys(PRIVATE_TABLES), ...Object.keys(PUBLIC_OWNED_TABLES), ...Object.keys(PUBLISHED_READ_TABLES), ...INSERT_ONLY_TABLES, ...Object.keys(APPEND_ONLY_TABLES)],
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
    ...ELIGIBILITY_FUNCTIONS,
    ...BUSY_FUNCTIONS,
    ...TRANSLATION_FUNCTIONS,
    ...BOOKING_TRIGGERS,
  ]
}

export async function applyRls(): Promise<void> {
  const { db } = await import('./client')
  for (const statement of rlsStatements()) await db.execute(sql.raw(statement))
}
