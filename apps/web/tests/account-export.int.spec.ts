import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { setStorageForTests } from '@kando/domain'
import { call, cleanupUsers, memoryStorage, seedBase, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const exportRoute = await import('../app/app-api/v1/me/export/route')

beforeAll(async () => {
  setStorageForTests(memoryStorage())
  const { categoryId } = await seedBase()
  for (const [uid, name] of [['ex1', 'Ada'], ['ex2', 'Bob']] as const) {
    await seedUser(uid)
    await pool.query("UPDATE users SET first_name = $2, last_name = 'Test', address_postcode = '10115', address_country = 'DE' WHERE id = $1", [uid, name])
    const p = (
      await pool.query(
        `INSERT INTO providers (owner_id, type, public_name, slug, base_postcode, location, vat_id, impressum)
         VALUES ($1, 'private', $2, $3, '10115', (SELECT location FROM postcodes WHERE code = '10115'), 'DE123', 'Impressum') RETURNING id`,
        [uid, `${name} T.`, `${uid}-slug`],
      )
    ).rows[0].id
    await pool.query("INSERT INTO services (provider_id, category_id, title, price_type) VALUES ($1, $2, $3, 'on-request')", [p, categoryId, `${name} service`])
    await pool.query("INSERT INTO provider_references (provider_id, client_name, description) VALUES ($1, $2, 'Job')", [p, `${name} client`])
    await pool.query("INSERT INTO photos (owner_id, kind, key, width, height) VALUES ($1, 'profile', $2, 1, 1)", [uid, `people/${uid}/p.jpg`])
    await pool.query("INSERT INTO documents (owner_id, requirement, key, status, note) VALUES ($1, 'permit', $2, 'rejected', 'blurry')", [uid, `documents/${uid}/d.pdf`])
    await pool.query('INSERT INTO private_files (owner_id, key) VALUES ($1, $2)', [uid, `documents/${uid}/f.pdf`])
    await pool.query("INSERT INTO notifications (user_id, kind, payload) VALUES ($1, 'profile-live', '{}')", [uid])
  }
  await seedUser('ex3') // a person without a provider
})
afterAll(async () => {
  setStorageForTests(undefined)
  await cleanupUsers()
})

it('exports only the caller own data, with signed links, and logs one line without data', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const res = await call(exportRoute.GET, 'ex1')
  const lines = log.mock.calls.map((c) => String(c[0]))
  log.mockRestore()
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.user).toMatchObject({ id: 'ex1', firstName: 'Ada', address: { postcode: '10115', country: 'DE' }, staffRole: null })
  expect(body.provider).toMatchObject({ vatId: 'DE123', impressum: 'Impressum', basePostcode: '10115', lat: expect.any(Number), lng: expect.any(Number) })
  expect(body.provider).not.toHaveProperty('location')
  expect(body.services.map((s: { title: string }) => s.title)).toEqual(['Ada service'])
  expect(body.references.map((r: { clientName: string }) => r.clientName)).toEqual(['Ada client'])
  expect(body.photos).toEqual([{ kind: 'profile', url: 'https://media.test/people/ex1/p.jpg', createdAt: expect.any(String) }])
  expect(body.documents).toEqual([
    { requirement: 'permit', status: 'rejected', staffNote: 'blurry', reviewedAt: null, createdAt: expect.any(String), downloadUrl: 'https://signed.test/documents/documents/ex1/d.pdf?expires=300' },
  ])
  expect(body.privateFiles[0].downloadUrl).toBe('https://signed.test/documents/documents/ex1/f.pdf?expires=300')
  expect(body.notifications).toHaveLength(1)
  expect(body.notes.length).toBeGreaterThanOrEqual(3)
  expect(JSON.stringify(body)).not.toMatch(/ex2|Bob/) // never the other person
  expect(lines.filter((l) => l.includes('data-export'))).toHaveLength(1)
  expect(JSON.parse(lines.find((l) => l.includes('data-export'))!)).toEqual({ event: 'data-export', userId: 'ex1', at: body.exportedAt })
})

it('a person without a provider exports provider null and empty lists', async () => {
  const body = await (await call(exportRoute.GET, 'ex3')).json()
  expect(body).toMatchObject({ provider: null, services: [], references: [], photos: [], documents: [], privateFiles: [], notifications: [] })
})

it('signed out is 401', async () => {
  const res = await exportRoute.GET(new Request('http://localhost/app-api/v1/me/export'), { params: Promise.resolve({}) })
  expect(res.status).toBe(401)
})
