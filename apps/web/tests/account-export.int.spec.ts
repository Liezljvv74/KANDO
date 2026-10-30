import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { setStorageForTests } from '@kando/domain/src/testing'
import { call, cleanupUsers, EMAIL, memoryStorage, seedBase, seedUser } from './helpers'

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

/** A small RFC 4180 reader: quoted fields with doubled quotes, commas and line breaks inside. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted && c === '"' && text[i + 1] === '"') {
      field += '"'
      i++
    } else if (quoted && c === '"') {
      quoted = false
    } else if (quoted) {
      field += c
    } else if (c === '"') {
      quoted = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
    } else {
      field += c
    }
  }
  return rows
}
const csv = (uid: string, format = 'csv') =>
  exportRoute.GET(new Request(`http://localhost/app-api/v1/me/export?format=${format}`, { headers: { cookie: `uid=${uid}:${EMAIL(uid)}` } }), { params: Promise.resolve({}) })

it('format=csv: BOM, text/csv, one row per field, tricky values survive a round trip, never the other person', async () => {
  const tricky = 'Müller, "Bau"\nGmbH – Café'
  await pool.query("INSERT INTO provider_references (provider_id, client_name, description) SELECT id, $2, 'x' FROM providers WHERE owner_id = $1", ['ex1', tricky])
  const res = await csv('ex1')
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
  const bytes = Buffer.from(await res.arrayBuffer())
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]) // the byte order mark (res.text() would drop it)
  const text = bytes.toString('utf8')
  expect(text).toContain('"Müller, ""Bau""\nGmbH – Café"')
  const rows = parseCsv(text.slice(1))
  expect(rows[0]).toEqual(['section', 'record', 'field', 'value'])
  expect(rows.every((r) => r.length === 4)).toBe(true)
  const value = (section: string, field: string, record = '1') => rows.find((r) => r[0] === section && r[1] === record && r[2] === field)?.[3]
  expect(value('user', 'email')).toBe(EMAIL('ex1'))
  expect(value('user', 'address.postcode')).toBe('10115')
  expect(value('provider', 'vatId')).toBe('DE123')
  expect(value('provider', 'location')).toBeUndefined()
  expect(rows.filter((r) => r[0] === 'references' && r[2] === 'clientName').map((r) => r[3]).sort()).toEqual(['Ada client', tricky].sort())
  expect(value('documents', 'downloadUrl')).toBe('https://signed.test/documents/documents/ex1/d.pdf?expires=300')
  expect(value('documents', 'createdAt')).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/)
  expect(rows.filter((r) => r[0] === 'notes').length).toBeGreaterThanOrEqual(3)
  expect(text).not.toMatch(/ex2|Bob/)
  // The JSON export of the same moment holds the same values.
  const json = await (await call(exportRoute.GET, 'ex1')).json()
  expect(value('user', 'firstName')).toBe(json.user.firstName)
  expect(value('provider', 'createdAt')).toBe(json.provider.createdAt)
  await pool.query("DELETE FROM provider_references WHERE client_name = $1", [tricky])
})

it('format=csv for a person without a provider has no provider rows; an unknown format is 400 BAD_FORMAT; default stays JSON', async () => {
  const rows = parseCsv(Buffer.from(await (await csv('ex3')).arrayBuffer()).toString('utf8').slice(1))
  expect(rows.some((r) => r[0] === 'provider')).toBe(false)
  expect(rows.some((r) => r[0] === 'user' && r[2] === 'id' && r[3] === 'ex3')).toBe(true)
  const bad = await csv('ex3', 'xml')
  expect(bad.status).toBe(400)
  expect(await bad.json()).toEqual({ error: 'BAD_FORMAT' })
  expect((await call(exportRoute.GET, 'ex3')).headers.get('content-type')).toContain('application/json')
})

it('format=csv neutralises spreadsheet formulas (the leading quote is intentional) and keeps empty objects and nulls as rows', async () => {
  const names = ['=HYPERLINK("http://x.test","hi")', '+cmd|calc', '@SUM(A1:A2)', '-5', '-1+2', '\tTabbed', 'safe', '  =1+1', '"=cmd', ' -2']
  for (const n of names) await pool.query("INSERT INTO provider_references (provider_id, client_name, description) SELECT id, $2, 'x' FROM providers WHERE owner_id = $1", ['ex1', n])
  const text = Buffer.from(await (await csv('ex1')).arrayBuffer()).toString('utf8').slice(1)
  const rows = parseCsv(text)
  const clients = rows.filter((r) => r[0] === 'references' && r[2] === 'clientName').map((r) => r[3])
  // Read back as written: the quote prefix is part of the value on purpose.
  expect(clients).toEqual(expect.arrayContaining(["'=HYPERLINK(\"http://x.test\",\"hi\")", "'+cmd|calc", "'@SUM(A1:A2)", '-5', "'-1+2", "'\tTabbed", 'safe', "'  =1+1", "'\"=cmd", "' -2"])) // a formula behind blanks or a quote mark too; " -2" is not a plain number
  expect(clients).not.toContain('-1+2')
  // The JSON export is unchanged.
  const json = await (await call(exportRoute.GET, 'ex1')).json()
  expect(json.references.map((r: { clientName: string }) => r.clientName)).toEqual(expect.arrayContaining(names))
  // The notification payload is {}: its row stays, as does every null field.
  expect(rows.find((r) => r[0] === 'notifications' && r[2] === 'payload')?.[3]).toBe('{}')
  expect(rows.find((r) => r[0] === 'user' && r[2] === 'suspendedUntil')).toEqual(['user', '1', 'suspendedUntil', ''])
  await pool.query('DELETE FROM provider_references WHERE client_name = ANY($1)', [names])
})
