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

export async function cleanupUsers(): Promise<void> {
  await pool.query("DELETE FROM private_files WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%@test.skilled.invalid')")
  await pool.query("DELETE FROM documents WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%@test.skilled.invalid')")
  await pool.query("DELETE FROM providers WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%@test.skilled.invalid')")
  await pool.query("DELETE FROM users WHERE email LIKE '%@test.skilled.invalid'")
}

export const profile = {
  displayName: 'Babysitting am Abend',
  providerType: 'individual',
  basePostcode: '10115',
  serviceRadiusKm: 25,
  worksRemotely: false,
}

/** In-memory object store: `objects` maps "bucket/key" to the bytes. Tests never touch S3. */
export function memoryStorage(): Storage & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>()
  return {
    objects,
    async put(bucket, key, body) {
      objects.set(`${bucket}/${key}`, body)
    },
    getSignedUrl: async (bucket, key, seconds) => `https://signed.test/${bucket}/${key}?expires=${seconds}`,
    async delete(bucket, key) {
      objects.delete(`${bucket}/${key}`)
    },
    publicUrl: (key) => `https://media.test/${key}`,
  }
}

/** Gives the user's provider a real profile photo row (publish needs one). */
export async function givePhoto(uid: string): Promise<void> {
  const p = await pool.query('SELECT id FROM providers WHERE owner_id = $1', [uid])
  const photo = await pool.query(
    "INSERT INTO photos (owner_id, provider_id, kind, key, width, height) VALUES ($1, $2, 'profile', $3, 1, 1) RETURNING id",
    [uid, p.rows[0].id, `providers/${p.rows[0].id}/seed.jpg`],
  )
  await pool.query('UPDATE providers SET photo_id = $1 WHERE owner_id = $2', [photo.rows[0].id, uid])
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
    `INSERT INTO providers (owner_id, type, display_name, public_name, slug, skills, base_postcode, location, service_radius_km, works_remotely, status, suspended)
     VALUES ($1, 'private', $2, $2, $3, $4, $5, (SELECT location FROM postcodes WHERE country = 'DE' AND code = $5), $6, $7, $8, $9) RETURNING id`,
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
export const seedUser = (id: string, staffRole: string | null = null, name: string | null = null) =>
  pool.query('INSERT INTO users (id, email, staff_role, name) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING', [id, EMAIL(id), staffRole, name])
