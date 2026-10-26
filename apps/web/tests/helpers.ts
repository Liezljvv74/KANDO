import { pool } from '@kando/db'

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
