import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { importPostcodes, pool } from '@kando/db'
import { seedCategories } from '@kando/db/src/seed/categories'
import { assertDevTarget } from '@kando/db/src/seed/guard'
import { setStorageForTests } from '@kando/domain'
import { addPlaceholderPhotos, confirmedOrDev } from '@kando/domain/src/seed/placeholder-photos'
import { neonAuth, seedTestUsers, TEST_PASSWORD } from '@kando/domain/src/seed/test-users'
import { memoryStorage } from './helpers'

const file = resolve(__dirname, '../../../packages/db/data/postcodes-de.tsv')
const storage = memoryStorage()
const DEV = { NEON_BRANCH: 'kando-dev', DATABASE_URL: 'postgres://u:p@ep-steep-scene-b9p4f2v6-pooler.c-7.eu-central-1.aws.neon.tech/neondb' }
const PROD = { NEON_BRANCH: 'main', DATABASE_URL: 'postgres://u:p@ep-other-prod-12345678.c-7.eu-central-1.aws.neon.tech/neondb' }
const count = async (sql: string) => Number((await pool.query(sql)).rows[0].n)
const OWNED = "owner_id IN (SELECT id FROM users WHERE email LIKE '%@example.com')"

// Stand-in for the Neon Auth user table (the real one only exists on the Neon branch).
const ids = new Map<string, string>()
const fakeAuth = {
  async signUp(email: string) {
    if (!ids.has(email)) {
      ids.set(email, randomUUID())
      await pool.query('INSERT INTO neon_auth."user" (id, email, "emailVerified") VALUES ($1, $2, false)', [ids.get(email), email])
    }
    return { id: ids.get(email)! }
  },
}

beforeAll(async () => {
  setStorageForTests(storage)
  await pool.query('CREATE SCHEMA IF NOT EXISTS neon_auth; CREATE TABLE IF NOT EXISTS neon_auth."user" (id text PRIMARY KEY, email text, "emailVerified" boolean)')
  await importPostcodes('DE', file)
})
afterEach(() => vi.unstubAllGlobals())
afterAll(async () => {
  setStorageForTests(undefined)
  await pool.query(`DELETE FROM photos WHERE ${OWNED}`)
  await pool.query(`DELETE FROM providers WHERE ${OWNED}`)
  await pool.query("DELETE FROM users WHERE email LIKE '%@example.com'")
  await pool.query('DROP SCHEMA neon_auth CASCADE')
})

it('categories seed is idempotent: 14 categories, both names, babysitting needs a police certificate', async () => {
  await seedCategories()
  await seedCategories()
  expect(await count('SELECT count(*) n FROM categories')).toBe(14)
  expect(await count("SELECT count(*) n FROM category_texts WHERE lang IN ('de','en')")).toBe(28)
  const { rows } = await pool.query("SELECT required_documents FROM categories WHERE slug = 'babysitting'")
  expect(rows[0].required_documents).toEqual(['police-certificate'])
})

it('postcode import upserts: a second run leaves the same count', async () => {
  const before = await count('SELECT count(*) n FROM postcodes')
  expect(before).toBeGreaterThan(8000)
  await importPostcodes('DE', file)
  expect(await count('SELECT count(*) n FROM postcodes')).toBe(before)
})

it('the dev guard needs the dev branch AND the dev database host', () => {
  expect(() => assertDevTarget({ ...DEV, NEON_BRANCH: 'main' })).toThrow(/Dev branch only/)
  expect(() => assertDevTarget({ DATABASE_URL: DEV.DATABASE_URL })).toThrow()
  expect(() => assertDevTarget(PROD)).toThrow()
  expect(() => assertDevTarget({ ...PROD, NEON_BRANCH: 'kando-dev' })).toThrow() // right name, wrong database
  expect(() => assertDevTarget(DEV)).not.toThrow()
  expect(() => assertDevTarget({ ...DEV, NEON_BRANCH: 'dev' })).not.toThrow()
  expect(() => assertDevTarget({ ...PROD, NEON_BRANCH: 'dev', NEON_DEV_ENDPOINT_ID: 'ep-other-prod-12345678' })).not.toThrow()
  expect(TEST_PASSWORD).toBe('TestPass123')
})

it('seedTestUsers itself refuses outside dev, before touching anything', async () => {
  await expect(seedTestUsers(fakeAuth, PROD)).rejects.toThrow(/Dev branch only/)
  expect(await count("SELECT count(*) n FROM users WHERE email LIKE '%@example.com'")).toBe(0)
})

it('builds the test users through the domain: published providers with photo, services, public names, verified; a rerun adds nothing', async () => {
  const first = await seedTestUsers(fakeAuth, DEV)
  expect(first).toEqual({ created: 14, skipped: 0 })
  expect(await count("SELECT count(*) n FROM users WHERE email LIKE '%@example.com'")).toBe(14)
  expect(await count(`SELECT count(*) n FROM providers WHERE status = 'published' AND photo_id IS NOT NULL AND ${OWNED}`)).toBe(9)
  expect(storage.objects.size).toBe(9)
  expect(await count('SELECT count(*) n FROM neon_auth."user" WHERE "emailVerified"')).toBe(14)
  const dj = (await pool.query("SELECT public_name, slug FROM providers WHERE business_name = 'Nordbeat Events GmbH'")).rows[0]
  expect(dj).toEqual({ public_name: 'Nordbeat Events GmbH', slug: 'nordbeat-events-gmbh' })
  const foto = (await pool.query("SELECT public_name FROM providers p JOIN users u ON u.id = p.owner_id WHERE u.email = 'anbieter.foto.berlin@example.com'")).rows[0]
  expect(foto.public_name).toBe('Lena F.')
  expect(await count(`SELECT count(*) n FROM services WHERE provider_id IN (SELECT id FROM providers WHERE ${OWNED})`)).toBe(14)
  // a rerun skips everything but still fixes the verified flag of existing accounts
  await pool.query('UPDATE neon_auth."user" SET "emailVerified" = false')
  expect(await seedTestUsers(fakeAuth, DEV)).toEqual({ created: 0, skipped: 14 })
  expect(await count('SELECT count(*) n FROM neon_auth."user" WHERE "emailVerified"')).toBe(14)
  expect(await count(`SELECT count(*) n FROM providers WHERE ${OWNED}`)).toBe(9)
})

it('placeholder photos: gives a published profile without a photo one; elsewhere needs the typed yes', async () => {
  await pool.query("UPDATE providers SET photo_id = NULL WHERE owner_id = (SELECT id FROM users WHERE email = 'anbieter.gassi.leipzig@example.com')")
  expect(await addPlaceholderPhotos()).toBeGreaterThanOrEqual(1)
  expect(await count(`SELECT count(*) n FROM providers WHERE photo_id IS NOT NULL AND ${OWNED}`)).toBe(9)
  expect(await addPlaceholderPhotos()).toBe(0)
  const ask = (answer: string) => async () => answer
  await expect(confirmedOrDev(DEV, ask('no'))).resolves.toBeUndefined()
  await expect(confirmedOrDev(PROD, ask('yes'))).rejects.toThrow(/ALLOW_PRODUCTION/)
  await expect(confirmedOrDev({ ...PROD, ALLOW_PRODUCTION: '1' }, ask('no'))).rejects.toThrow(/Cancelled/)
  await expect(confirmedOrDev({ ...PROD, ALLOW_PRODUCTION: '1' }, ask('yes'))).resolves.toBeUndefined()
})

const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status })
const mockFetch = (...responses: Response[]) => {
  const f = vi.fn(async (..._a: unknown[]) => responses.shift()!)
  vi.stubGlobal('fetch', f)
  return f
}
const called = (f: ReturnType<typeof mockFetch>) => f.mock.calls.map((c) => String(c[0]).split('/').slice(-2).join('/'))

it('neonAuth retries a 429, then succeeds', async () => {
  const f = mockFetch(reply(429, {}), reply(200, { user: { id: 'u1' } }))
  expect(await neonAuth('http://auth.test/', 1).signUp('a@example.com', 'x', 'A')).toEqual({ id: 'u1' })
  expect(called(f)).toEqual(['sign-up/email', 'sign-up/email'])
})

it('neonAuth signs in when the email already exists', async () => {
  const f = mockFetch(reply(422, { code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' }), reply(200, { user: { id: 'u2' } }))
  expect(await neonAuth('http://auth.test', 1).signUp('a@example.com', 'x', 'A')).toEqual({ id: 'u2' })
  expect(called(f)).toEqual(['sign-up/email', 'sign-in/email'])
})

it('neonAuth surfaces any other sign-up failure without falling back to sign-in', async () => {
  const f = mockFetch(reply(400, { code: 'INVALID_PASSWORD' }))
  await expect(neonAuth('http://auth.test', 1).signUp('a@example.com', 'x', 'A')).rejects.toThrow(/sign-up failed.*HTTP 400/)
  expect(called(f)).toEqual(['sign-up/email'])
})
