import { pool } from '@kando/db'
import type { Storage } from '@kando/domain'

// Fake session: cookie "uid=<id>:<email>" is a confirmed session, plus "verified=0" an unconfirmed one and "name=<name>"
// the account name (each test file mocks lib/auth/server with `fakeSession`).
export const fakeSession = async (request: Request) => {
  const cookie = request.headers.get('cookie') ?? ''
  const m = /uid=([^:;]+):([^;]+)/.exec(cookie)
  const name = /(?:^|; )name=([^;]*)/.exec(cookie)?.[1]
  return m ? { id: m[1]!, email: m[2]!, emailVerified: !/(?:^|; )verified=0/.test(cookie), name: name === undefined ? undefined : decodeURIComponent(name) } : null
}

export const EMAIL = (id: string) => `${id}@test.skilled.invalid`

export function call(
  handler: (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>,
  uid: string,
  method = 'GET',
  body?: unknown,
  params: Record<string, string> = {},
) {
  return handler(
    new Request('http://localhost/app-api/v1/x', {
      method,
      headers: { cookie: `uid=${uid}:${EMAIL(uid)}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve(params) },
  )
}

export async function seedBase(): Promise<{ categoryId: string; docCategoryId: string }> {
  await pool.query(
    `INSERT INTO postcodes (country, code, place, state, location) VALUES
     ('DE', '10115', 'Berlin', 'Berlin', ST_SetSRID(ST_MakePoint(13.3, 52.5), 4326)) ON CONFLICT DO NOTHING`,
  )
  const slug = `t5-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const a = await pool.query("INSERT INTO categories (slug) VALUES ($1) RETURNING id", [slug])
  const b = await pool.query(
    "INSERT INTO categories (slug, required_documents) VALUES ($1, ARRAY['police-certificate']) RETURNING id",
    [`${slug}-doc`],
  )
  return { categoryId: a.rows[0].id, docCategoryId: b.rows[0].id }
}

/** Runs fn in one transaction on one owner-connection client (for a SET LOCAL / set_config(..., true) that must cover the statements). */
async function ownerTransaction(fn: (q: (text: string, values?: unknown[]) => Promise<unknown>) => Promise<void>): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await fn((text, values) => client.query(text, values))
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

/** Quotes are final once written (rls.ts IMMUTABLE_COLUMNS); a test ages them with the guard off inside its own transaction. */
export const expireQuotes = (where: string, values: unknown[]) =>
  ownerTransaction(async (q) => {
    await q('ALTER TABLE quotes DISABLE TRIGGER keep_parties')
    await q(`UPDATE quotes SET expires_at = now() - interval '1 minute' WHERE ${where}`, values)
    await q('ALTER TABLE quotes ENABLE TRIGGER keep_parties')
  })

export async function cleanupUsers(): Promise<void> {
  const mine = "(SELECT id FROM users WHERE email LIKE '%@test.skilled.invalid')"
  await pool.query(`DELETE FROM notifications WHERE user_id IN ${mine}`)
  await pool.query(`DELETE FROM push_tokens WHERE user_id IN ${mine}`)
  const myProviders = `(SELECT id FROM providers WHERE owner_id IN ${mine})`
  const myThreads = `(SELECT id FROM threads WHERE customer_id IN ${mine} OR provider_id IN ${myProviders})`
  await pool.query(`DELETE FROM contact_attempts WHERE user_id IN ${mine} OR thread_id IN ${myThreads}`)
  await pool.query(`DELETE FROM staff_flags WHERE user_id IN ${mine}`)
  await pool.query(`DELETE FROM staff_access_log WHERE staff_id IN ${mine}`)
  await pool.query(`DELETE FROM messages WHERE sender_id IN ${mine} OR thread_id IN ${myThreads}`)
  await pool.query(`DELETE FROM threads WHERE customer_id IN ${mine} OR provider_id IN ${myProviders}`)
  await pool.query(`DELETE FROM blocks WHERE blocker_id IN ${mine} OR blocked_id IN ${mine}`)
  await pool.query(`DELETE FROM availability_watches WHERE customer_id IN ${mine} OR provider_id IN ${myProviders}`)
  // Ledger rows are append-only (trigger ledger_append_only); the test clean-up alone switches that off, for its own transaction.
  await ownerTransaction(async (q) => {
    await q("SELECT set_config('kando.ledger_cleanup', 'on', true)")
    await q(`DELETE FROM ledger_entries WHERE provider_id IN ${myProviders} OR booking_id IN (SELECT id FROM bookings WHERE customer_id IN ${mine})`)
  })
  // Invoices keep plain ids (they outlive account deletion): a test's invoices go by its people, its providers, or a
  // booking of theirs (a deleted customer's invoice still has the provider), and their numbering series with them.
  await pool.query(`DELETE FROM invoice_counters WHERE left(series, 8) IN (SELECT upper(left(id::text, 8)) FROM providers WHERE owner_id IN ${mine})`)
  await pool.query(`DELETE FROM invoices WHERE customer_id IN ${mine} OR provider_id IN ${myProviders}`)
  const myBookings = `(SELECT id FROM bookings WHERE customer_id IN ${mine} OR provider_id IN ${myProviders})`
  await pool.query(`DELETE FROM disputes WHERE booking_id IN ${myBookings}`)
  await pool.query(`DELETE FROM reviews WHERE booking_id IN ${myBookings} OR author_id IN ${mine} OR subject_id IN ${mine}`)
  await pool.query(`DELETE FROM bookings WHERE customer_id IN ${mine} OR provider_id IN ${myProviders}`)
  await pool.query(`DELETE FROM quotes WHERE provider_id IN ${myProviders}`)
  await pool.query(`DELETE FROM requests WHERE customer_id IN ${mine} OR provider_id IN ${myProviders}`)
  await pool.query(`DELETE FROM photos WHERE owner_id IN ${mine}`)
  await pool.query("DELETE FROM private_files WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%@test.skilled.invalid')")
  await pool.query("DELETE FROM documents WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%@test.skilled.invalid')")
  await pool.query("DELETE FROM providers WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%@test.skilled.invalid')")
  await pool.query("DELETE FROM users WHERE email LIKE '%@test.skilled.invalid'")
}

export const profile = {
  skills: ['Gartenarbeit'],
  strengths: 'Zuverlässig',
  experience: '5 Jahre',
  providerType: 'individual',
  basePostcode: '10115',
  serviceRadiusKm: 25,
  worksRemotely: false,
}

/** In-memory object store: `objects` maps "bucket/key" to the bytes, `types` to the content type. Tests never touch S3. */
export function memoryStorage(): Storage & { objects: Map<string, Buffer>; types: Map<string, string> } {
  const objects = new Map<string, Buffer>()
  const types = new Map<string, string>()
  return {
    objects,
    types,
    async put(bucket, key, body, contentType) {
      objects.set(`${bucket}/${key}`, body)
      types.set(`${bucket}/${key}`, contentType)
    },
    getSignedUrl: async (bucket, key, seconds) => `https://signed.test/${bucket}/${key}?expires=${seconds}`,
    async delete(bucket, key) {
      objects.delete(`${bucket}/${key}`)
    },
    publicUrl: (key) => `https://media.test/${key}`,
  }
}

/** Gives the person a profile photo row (no provider; publish needs one). */
export async function givePhoto(uid: string): Promise<void> {
  await pool.query("INSERT INTO photos (owner_id, kind, key, width, height) VALUES ($1, 'profile', $2, 1, 1)", [uid, `users/${uid}/profile.jpg`])
}

/** A provider written straight through the owner connection (fast fixtures for search tests). Returns its id. */
export async function seedProvider(
  uid: string,
  o: {
    name: string
    categoryId: string
    postcode?: string | null
    radius?: number
    remote?: boolean
    skills?: string[]
    status?: string
    suspended?: boolean
    price?: number | null
  },
): Promise<string> {
  await pool.query('INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING', [uid, EMAIL(uid)])
  const postcode = o.postcode === undefined ? '10115' : o.postcode
  const p = await pool.query(
    `INSERT INTO providers (owner_id, type, public_name, slug, skills, base_postcode, location, service_radius_km, works_remotely, status, suspended_until)
     VALUES ($1, 'private', $2, $3, $4, $5, (SELECT location FROM postcodes WHERE country = 'DE' AND code = $5), $6, $7, $8, CASE WHEN $9::boolean THEN now() + interval '1 day' END) RETURNING id`,
    [uid, o.name, `${uid}-slug`, o.skills ?? [], postcode, o.radius ?? 25, o.remote ?? false, o.status ?? 'published', o.suspended ?? false],
  )
  const price = o.price === undefined ? 10 : o.price
  await pool.query(
    "INSERT INTO services (provider_id, category_id, title, price_type, price) VALUES ($1, $2, $3, $4, $5)",
    [p.rows[0].id, o.categoryId, `${o.name} service`, price === null ? 'on-request' : 'fixed', price],
  )
  return p.rows[0].id
}

/** Who the faked staff session belongs to (the admin specs mock getAuth().getSession with it); '' = signed out. */
export const staff = { id: '' }
export const mockAuth = async () => ({
  getAuth: () => ({ getSession: async () => ({ data: staff.id ? { user: { id: staff.id } } : null }) }),
})

type Route = (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>
/** Calls an admin route handler as `uid` ('' = signed out). `path` is only for the URL (query strings go here). */
export function adminCall(handler: Route, uid: string, method = 'GET', path = '/api/admin/x', body?: unknown, params: Record<string, string> = {}) {
  staff.id = uid
  return handler(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve(params) },
  )
}

/** A user row written straight through the owner connection. */
export const seedUser = (id: string, staffRole: string | null = null, name: string | null = null) => {
  const [first = null, ...rest] = name?.split(' ') ?? []
  return pool.query('INSERT INTO users (id, email, staff_role, first_name, last_name) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING', [id, EMAIL(id), staffRole, first, rest.join(' ') || null])
}

/**
 * Tests that legitimately create many requests or bookings for one customer call this first: it closes the customer's open
 * requests and moves their earlier requests and direct bookings out of the 24-hour window, so the abuse limits (abuse-limits.int.spec.ts) stay out of the way.
 */
export async function relaxLimits(uid: string): Promise<void> {
  await pool.query("UPDATE requests SET status = CASE WHEN status IN ('open','quoted') THEN 'withdrawn' ELSE status END, created_at = created_at - interval '2 days' WHERE customer_id = $1 AND created_at > now() - interval '1 day'", [uid])
  await pool.query("UPDATE bookings SET created_at = created_at - interval '2 days' WHERE customer_id = $1 AND source = 'direct' AND created_at > now() - interval '1 day'", [uid])
}
