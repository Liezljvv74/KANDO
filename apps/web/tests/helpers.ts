import { pool } from '@kando/db'
import type { Storage } from '@kando/domain'

// Fake session: cookie "uid=<id>:<email>" is a session (each test file mocks lib/auth/server with `fakeSession`).
export const fakeSession = async (request: Request) => {
  const m = /uid=([^:;]+):([^;]+)/.exec(request.headers.get('cookie') ?? '')
  return m ? { id: m[1]!, email: m[2]! } : null
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
