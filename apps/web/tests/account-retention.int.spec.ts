import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { clearOutbox } from '@kando/domain'
import { outboxForTests, setStorageForTests } from '@kando/domain/src/testing'
import { cleanupUsers, EMAIL, memoryStorage, seedBase, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ ...(await (await import('./helpers')).mockAuth()), sessionFromRequest: (await import('./helpers')).fakeSession }))
const me = await import('../app/app-api/v1/me/route')
const cron = await import('../app/api/cron/suspensions/route')

const store = memoryStorage()
let categoryId: string
let createdNeonAuth = false

beforeAll(async () => {
  setStorageForTests(store)
  ;({ categoryId } = await seedBase())
  // Stand-in for the Neon Auth user table: the app answers 401 for an id it does not know.
  createdNeonAuth = !(await pool.query("SELECT to_regnamespace('neon_auth') AS s")).rows[0].s
  await pool.query(`CREATE SCHEMA IF NOT EXISTS neon_auth; CREATE TABLE IF NOT EXISTS neon_auth."user" (id text PRIMARY KEY, email text, "emailVerified" boolean)`)
})
beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', '')
  vi.stubEnv('CRON_SECRET', 's3cret')
  clearOutbox()
  store.objects.clear()
})
afterEach(() => vi.unstubAllEnvs())
afterAll(async () => {
  setStorageForTests(undefined)
  await pool.query("DELETE FROM retained_records WHERE former_user_id LIKE 'rt%'")
  await pool.query('DELETE FROM pending_object_deletes')
  await cleanupUsers()
  await pool.query('DELETE FROM neon_auth."user"')
  if (createdNeonAuth) await pool.query('DROP SCHEMA neon_auth CASCADE')
})

const del = (uid: string) =>
  me.DELETE(
    new Request('http://localhost/app-api/v1/me', { method: 'DELETE', headers: { origin: 'http://localhost', cookie: `uid=${uid}:${EMAIL(uid)}`, 'content-type': 'application/json' }, body: JSON.stringify({ password: 'right-password' }) }),
    { params: Promise.resolve({}) },
  )
const runCron = () => cron.GET(new Request('http://localhost/api/cron/suspensions', { headers: { authorization: 'Bearer s3cret' } }))
const count = async (sql: string, params: unknown[] = []) => Number((await pool.query(sql, params)).rows[0].n)

const person = async (uid: string, lang = 'de') => {
  await pool.query('INSERT INTO neon_auth."user" (id, email, "emailVerified") VALUES ($1, $2, true) ON CONFLICT DO NOTHING', [uid, EMAIL(uid)])
  await seedUser(uid)
  await pool.query(
    "UPDATE users SET language = $2, first_name = 'Rita', last_name = 'Trader', address_street = 'Weg 1', address_postcode = '10115', address_city = 'Berlin', address_country = 'DE' WHERE id = $1",
    [uid, lang],
  )
}
async function provider(uid: string) {
  return (
    await pool.query(
      `INSERT INTO providers (owner_id, type, business_name, public_name, slug, base_postcode, location, status, legal_status, vat_id, impressum)
       VALUES ($1, 'business', 'Rita GmbH', 'Rita T.', $2, '10115', (SELECT location FROM postcodes WHERE code = '10115'), 'published', 'business', 'DE123456789', 'Impressum text') RETURNING id`,
      [uid, `${uid}-slug`],
    )
  ).rows[0].id as string
}
/** Objects for a provider with a profile photo, a submitted approved document, a pending one and an unsubmitted file. */
async function fullTrader(uid: string) {
  await person(uid)
  const pid = await provider(uid)
  await pool.query("INSERT INTO services (provider_id, category_id, title, price_type) VALUES ($1, $2, 'Garden', 'on-request')", [pid, categoryId])
  const keys = { photo: `people/${uid}/p.jpg`, file: `documents/${uid}/f.pdf`, approved: `documents/${uid}/a.pdf`, pending: `documents/${uid}/b.pdf` }
  store.objects.set(`media/${keys.photo}`, Buffer.from('x'))
  for (const k of [keys.file, keys.approved, keys.pending]) store.objects.set(`documents/${k}`, Buffer.from('x'))
  await pool.query("INSERT INTO photos (owner_id, kind, key, width, height) VALUES ($1, 'profile', $2, 1, 1)", [uid, keys.photo])
  await pool.query('INSERT INTO private_files (owner_id, key) VALUES ($1, $2)', [uid, keys.file])
  await pool.query("INSERT INTO documents (owner_id, requirement, key, status, note, reviewed_at) VALUES ($1, 'police-certificate', $2, 'approved', 'ok', '2026-01-02T10:00:00Z')", [uid, keys.approved])
  await pool.query("INSERT INTO documents (owner_id, requirement, key) VALUES ($1, 'permit', $2)", [uid, keys.pending])
  return keys
}
const retained = async (uid: string) => (await pool.query('SELECT *, delete_after - now() AS left FROM retained_records WHERE former_user_id = $1', [uid])).rows

it('a provider with documents: one retained record, the document rows gone, their objects kept, everything else deleted', async () => {
  const keys = await fullTrader('rt1')
  expect((await del('rt1')).status).toBe(200)
  const records = await retained('rt1')
  expect(records).toHaveLength(1)
  const r = records[0]
  expect(r.details).toMatchObject({
    name: 'Rita Trader',
    businessName: 'Rita GmbH',
    email: EMAIL('rt1'),
    address: { street: 'Weg 1', postcode: '10115', city: 'Berlin', country: 'DE' },
    legalStatus: 'business',
    vatId: 'DE123456789',
    providerType: 'business',
    impressum: 'Impressum text',
    deletedAt: expect.any(String),
  })
  expect(r.documents).toHaveLength(2)
  expect(r.documents).toEqual(
    expect.arrayContaining([
      { bucket: 'documents', key: keys.approved, requirement: 'police-certificate', status: 'approved', staffNote: 'ok', reviewedAt: '2026-01-02T10:00:00.000Z', uploadedAt: expect.any(String) },
      { bucket: 'documents', key: keys.pending, requirement: 'permit', status: 'pending', staffNote: null, reviewedAt: null, uploadedAt: expect.any(String) },
    ]),
  )
  const monthsLeft = r.left.days / 30.44
  expect(monthsLeft).toBeGreaterThan(5.8)
  expect(monthsLeft).toBeLessThan(6.1)
  expect(await count("SELECT count(*) n FROM documents WHERE owner_id = 'rt1'")).toBe(0)
  expect(await count("SELECT count(*) n FROM private_files WHERE owner_id = 'rt1'")).toBe(0)
  expect(await count("SELECT count(*) n FROM providers WHERE owner_id = 'rt1'")).toBe(0)
  expect([...store.objects.keys()].sort()).toEqual([`documents/${keys.approved}`, `documents/${keys.pending}`].sort()) // only the retained documents
  expect(await count('SELECT count(*) n FROM pending_object_deletes')).toBe(0)
  const [mail] = outboxForTests()
  expect(mail!.subject).toContain('aufbewahren')
  expect(mail!.text).toContain('6 Monate')
  expect(mail!.text).toContain(new Date(r.delete_after).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' }))
})

it('a customer without provider and documents keeps nothing; the email is the plain one', async () => {
  await person('rt2', 'en')
  store.objects.set('documents/documents/rt2/f.pdf', Buffer.from('x'))
  await pool.query("INSERT INTO private_files (owner_id, key) VALUES ('rt2', 'documents/rt2/f.pdf')")
  expect((await del('rt2')).status).toBe(200)
  expect(await retained('rt2')).toEqual([])
  expect(store.objects.size).toBe(0) // an unsubmitted file is not retained
  expect(outboxForTests()[0]!.subject).toBe('Your account has been deleted')
})

it('a provider without documents: a snapshot with an empty document list', async () => {
  await person('rt3')
  await provider('rt3')
  expect((await del('rt3')).status).toBe(200)
  const [r] = await retained('rt3')
  expect(r.documents).toEqual([])
  expect(r.details).toMatchObject({ businessName: 'Rita GmbH', vatId: 'DE123456789' })
})

it('DELETE_RETENTION_MONTHS=0 switches it off: no record, the document objects go as before', async () => {
  vi.stubEnv('DELETE_RETENTION_MONTHS', '0')
  const keys = await fullTrader('rt4')
  expect((await del('rt4')).status).toBe(200)
  expect(await retained('rt4')).toEqual([])
  expect(store.objects.size).toBe(0)
  expect(keys.approved).toBeTruthy()
  expect(outboxForTests()[0]!.subject).toContain('gelöscht')
  expect(outboxForTests()[0]!.subject).not.toContain('aufbewahren')
})

it('deleting twice: the second call is 401 and there is still one record', async () => {
  await fullTrader('rt5')
  expect((await del('rt5')).status).toBe(200)
  expect((await del('rt5')).status).toBe(401)
  expect(await retained('rt5')).toHaveLength(1)
})

it('the daily job removes only expired records with their objects and keeps a fresh one', async () => {
  const docs = (uid: string) => [{ bucket: 'documents', key: `documents/${uid}/x.pdf`, requirement: 'permit', status: 'approved', staffNote: null, reviewedAt: null, uploadedAt: '2026-01-01T00:00:00Z' }]
  store.objects.set('documents/documents/rt6/x.pdf', Buffer.from('x'))
  store.objects.set('documents/documents/rt7/x.pdf', Buffer.from('x'))
  await pool.query("INSERT INTO retained_records (former_user_id, details, documents, delete_after) VALUES ('rt6', '{}', $1, now() - interval '1 day')", [JSON.stringify(docs('rt6'))])
  await pool.query("INSERT INTO retained_records (former_user_id, details, documents, delete_after) VALUES ('rt7', '{}', $1, now() + interval '30 days')", [JSON.stringify(docs('rt7'))])
  const res = await runCron()
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ purged: 1 })
  expect(await retained('rt6')).toEqual([])
  expect(await retained('rt7')).toHaveLength(1)
  expect([...store.objects.keys()]).toEqual(['documents/documents/rt7/x.pdf'])
})

it('storage down at expiry: the record still goes, the objects stay owed, and the retry removes them', async () => {
  store.objects.set('documents/documents/rt8/x.pdf', Buffer.from('x'))
  await pool.query(
    "INSERT INTO retained_records (former_user_id, details, documents, delete_after) VALUES ('rt8', '{}', $1, now() - interval '1 day')",
    [JSON.stringify([{ bucket: 'documents', key: 'documents/rt8/x.pdf', requirement: 'permit', status: 'approved', staffNote: null, reviewedAt: null, uploadedAt: '2026-01-01T00:00:00Z' }])],
  )
  setStorageForTests({ ...store, delete: async () => { throw new TypeError('down') } })
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect((await runCron()).status).toBe(200)
  log.mockRestore()
  expect(await retained('rt8')).toEqual([])
  expect(await count('SELECT count(*) n FROM pending_object_deletes')).toBe(1)
  setStorageForTests(store)
  expect((await runCron()).status).toBe(200)
  expect(await count('SELECT count(*) n FROM pending_object_deletes')).toBe(0)
  expect(store.objects.size).toBe(0)
})

it('the app role can neither read nor write retained_records', async () => {
  const { rows } = await pool.query("SELECT has_table_privilege('app_user', 'retained_records', 'SELECT') OR has_table_privilege('app_user', 'retained_records', 'INSERT') OR has_table_privilege('app_user', 'retained_records', 'UPDATE') OR has_table_privilege('app_user', 'retained_records', 'DELETE') AS any_right")
  expect(rows[0].any_right).toBe(false)
})
