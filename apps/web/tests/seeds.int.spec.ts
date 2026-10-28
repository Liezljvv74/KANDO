import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { importPostcodes, pool } from '@kando/db'
import { DOCUMENT_TYPES } from '@kando/contract'
import { applyDocumentLists, CATEGORIES, seedCategories } from '@kando/db/src/seed/categories'
import { assertDevTarget } from '@kando/db/src/seed/guard'
import { setStorageForTests } from '@kando/domain'
import { addPlaceholderPhotos, confirmedOrDev } from '@kando/domain/src/seed/placeholder-photos'
import { loadSeedData, neonAuth, seedTestUsers, type SeedData } from '@kando/domain/src/seed/test-users'
import { memoryStorage } from './helpers'

const file = resolve(__dirname, '../../../packages/db/data/postcodes-de.tsv')
const storage = memoryStorage()
const DEV = { NEON_BRANCH: 'kando-dev', DATABASE_URL: 'postgres://u:p@ep-steep-scene-b9p4f2v6-pooler.c-7.eu-central-1.aws.neon.tech/neondb' }
const PROD = { NEON_BRANCH: 'main', DATABASE_URL: 'postgres://u:p@ep-other-prod-12345678.c-7.eu-central-1.aws.neon.tech/neondb' }
const count = async (sql: string, params: unknown[] = []) => Number((await pool.query(sql, params)).rows[0].n)
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

// Dropped at the end only if this file created it (the test database never has the real one, but do not assume).
let createdNeonAuth = false
beforeAll(async () => {
  setStorageForTests(storage)
  createdNeonAuth = !(await pool.query("SELECT to_regnamespace('neon_auth') AS s")).rows[0].s
  await pool.query('CREATE SCHEMA IF NOT EXISTS neon_auth; CREATE TABLE IF NOT EXISTS neon_auth."user" (id text PRIMARY KEY, email text, "emailVerified" boolean)')
  await importPostcodes('DE', file)
})
afterEach(() => vi.unstubAllGlobals())
afterAll(async () => {
  setStorageForTests(undefined)
  await pool.query(`DELETE FROM photos WHERE ${OWNED}`)
  await pool.query(`DELETE FROM providers WHERE ${OWNED}`)
  await pool.query("DELETE FROM users WHERE email LIKE '%@example.com'")
  if (createdNeonAuth) await pool.query('DROP SCHEMA neon_auth CASCADE')
})

it('categories seed is idempotent: 14 categories, both names, babysitting needs a police certificate', async () => {
  await seedCategories()
  await seedCategories()
  // Other spec files leave their own categories behind; count only the seeded slugs.
  const slugs = CATEGORIES.map((c) => c.slug)
  expect(slugs).toHaveLength(14)
  expect(await count('SELECT count(*) n FROM categories WHERE slug = ANY($1)', [slugs])).toBe(14)
  expect(
    await count("SELECT count(*) n FROM category_texts t JOIN categories c ON c.id = t.category_id WHERE c.slug = ANY($1) AND t.lang IN ('de','en')", [slugs]),
  ).toBe(28)
  const { rows } = await pool.query("SELECT required_documents, optional_documents FROM categories WHERE slug = 'babysitting'")
  expect(rows[0]).toEqual({ required_documents: ['id-document', 'trade-registration', 'police-certificate'], optional_documents: ['liability-insurance', 'first-aid-certificate'] })
})

// Counts from the "Per category" sheet of required-documents-draft.xlsx: [required, optional] per category.
const TABLE: Record<string, [number, number]> = {
  photography: [2, 1], dj: [2, 1], catering: [5, 0], 'digital-services': [2, 1], marketing: [2, 1], 'management-consulting': [2, 1], 'dog-walking': [4, 1],
  babysitting: [3, 2], cleaning: [3, 1], 'moving-clearance': [3, 0], assembly: [3, 0], gardening: [3, 0], 'small-repairs': [3, 1], 'other-services': [2, 1],
}

it('the seeded requirement table matches the sheet: everyone needs an ID and a trade registration, lists never overlap', async () => {
  await pool.query('UPDATE categories SET required_documents = $2, optional_documents = $2 WHERE slug = ANY($1)', [CATEGORIES.map((c) => c.slug), []])
  await applyDocumentLists()
  for (const c of CATEGORIES) {
    const { rows } = await pool.query('SELECT required_documents r, optional_documents o FROM categories WHERE slug = $1', [c.slug])
    expect(rows[0].r, c.slug).toEqual(expect.arrayContaining(['id-document', 'trade-registration']))
    expect([rows[0].r.length, rows[0].o.length], c.slug).toEqual(TABLE[c.slug])
    expect(rows[0].r.filter((d: string) => rows[0].o.includes(d)), c.slug).toEqual([])
    for (const d of [...rows[0].r, ...rows[0].o]) expect(DOCUMENT_TYPES as readonly string[], d).toContain(d)
  }
})

it('a re-seed keeps the lists staff edited, but keeps the sort current; the one-off script resets them', async () => {
  await pool.query("UPDATE categories SET required_documents = ARRAY['permit'], optional_documents = ARRAY['id-document'], sort = 99 WHERE slug = 'gardening'")
  await seedCategories()
  const { rows } = await pool.query("SELECT required_documents, optional_documents, sort FROM categories WHERE slug = 'gardening'")
  expect(rows[0]).toEqual({ required_documents: ['permit'], optional_documents: ['id-document'], sort: 12 })
  await applyDocumentLists()
  expect((await pool.query("SELECT required_documents FROM categories WHERE slug = 'gardening'")).rows[0].required_documents).toEqual(['id-document', 'trade-registration', 'liability-insurance'])
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
  // an empty override falls back to the dev endpoint instead of matching every host
  expect(() => assertDevTarget({ ...PROD, NEON_BRANCH: 'kando-dev', NEON_DEV_ENDPOINT_ID: '' })).toThrow(/Dev branch only/)
  expect(() => assertDevTarget({ ...DEV, NEON_DEV_ENDPOINT_ID: '' })).not.toThrow()
})

// The real account list is git-ignored; the tests use this fixture so they never depend on it.
const SEED: SeedData = {
  password: 'TestPass123',
  customers: [
    { email: 'kunde.berlin@example.com', firstName: 'Anna', lastName: 'Schulz' },
    { email: 'customer.hamburg@example.com', firstName: 'James', lastName: 'Miller', language: 'en', address: { street: 'Example Street 1', postcode: '20095', city: 'Hamburg', country: 'DE' } },
  ],
  providers: [
    {
      email: 'anbieter.foto.berlin@example.com', firstName: 'Lena', lastName: 'Fischer',
      profile: { providerType: 'individual', basePostcode: '10115', serviceRadiusKm: 50, bio: 'Hochzeiten und Familienfeste.', strengths: 'Ruhige Art.', skills: ['Hochzeiten'], experience: 'Seit 2015' },
      services: [
        { category: 'photography', title: 'Hochzeitsreportage', description: '8 Stunden.', priceType: 'fixed', price: 1490 },
        { category: 'photography', title: 'Portrait-Shooting', description: '1 Stunde.', priceType: 'from', price: 129 },
      ],
      references: [{ clientName: 'Familie Krüger', description: 'Hochzeit, 120 Gäste.', year: 2025 }],
    },
    {
      email: 'anbieter.dj.hamburg@example.com', firstName: 'Tom', lastName: 'Nord',
      profile: { providerType: 'business', businessName: 'Nordbeat Events GmbH', impressum: 'Nordbeat Events GmbH, Beispielstraße 1, 20095 Hamburg (Testdaten)', basePostcode: '20095', serviceRadiusKm: 80, bio: 'Musik für jede Feier.', strengths: 'Eigene Technik.', skills: ['Hochzeiten'], experience: 'Seit 2012' },
      services: [{ category: 'dj', title: 'Hochzeits-DJ', description: 'Bis 2 Uhr.', priceType: 'from', price: 890 }],
      references: [{ clientName: 'Hafenwerk GmbH', description: 'Sommerfest, 300 Gäste.', year: 2024 }],
    },
  ],
}

it('loadSeedData reads the git-ignored list or the committed example, and rejects a broken file', () => {
  const data = loadSeedData()
  expect(data.password.length).toBeGreaterThan(0)
  expect(data.customers.length + data.providers.length).toBeGreaterThan(0)
  expect(() => loadSeedData(new URL('../package.json', import.meta.url))).toThrow(/needs password/)
})

it('seedTestUsers itself refuses outside dev, before touching anything', async () => {
  await expect(seedTestUsers(fakeAuth, PROD, SEED)).rejects.toThrow(/Dev branch only/)
  expect(await count("SELECT count(*) n FROM users WHERE email LIKE '%@example.com'")).toBe(0)
})

it('builds the test users through the domain: published providers with photo, services, public names, verified; a rerun adds nothing', async () => {
  const first = await seedTestUsers(fakeAuth, DEV, SEED)
  expect(first).toEqual({ created: 4, skipped: 0 })
  expect(await count("SELECT count(*) n FROM users WHERE email LIKE '%@example.com'")).toBe(4)
  expect(await count(`SELECT count(*) n FROM providers WHERE status = 'published' AND (SELECT count(*) FROM photos ph WHERE ph.owner_id = providers.owner_id AND ph.kind = 'profile' AND ph.provider_id IS NULL) = 1 AND ${OWNED}`)).toBe(2)
  expect(storage.objects.size).toBe(2)
  expect(await count('SELECT count(*) n FROM neon_auth."user" WHERE "emailVerified"')).toBe(4)
  const dj = (await pool.query("SELECT public_name, slug FROM providers WHERE business_name = 'Nordbeat Events GmbH'")).rows[0]
  expect(dj).toEqual({ public_name: 'Nordbeat Events GmbH', slug: 'nordbeat-events-gmbh' })
  const foto = (await pool.query("SELECT public_name FROM providers p JOIN users u ON u.id = p.owner_id WHERE u.email = 'anbieter.foto.berlin@example.com'")).rows[0]
  expect(foto.public_name).toBe('Lena F.')
  const names = (await pool.query("SELECT first_name, last_name, address_city, address_country FROM users WHERE email LIKE '%@example.com' ORDER BY email")).rows
  expect(names).toEqual([
    { first_name: 'Tom', last_name: 'Nord', address_city: null, address_country: null },
    { first_name: 'Lena', last_name: 'Fischer', address_city: null, address_country: null },
    { first_name: 'James', last_name: 'Miller', address_city: 'Hamburg', address_country: 'DE' },
    { first_name: 'Anna', last_name: 'Schulz', address_city: null, address_country: null },
  ])
  expect(await count("SELECT count(*) n FROM photos WHERE owner_id IN (SELECT id FROM users WHERE email LIKE 'k%@example.com' OR email LIKE 'c%@example.com')")).toBe(0)
  expect(await count(`SELECT count(*) n FROM services WHERE provider_id IN (SELECT id FROM providers WHERE ${OWNED})`)).toBe(3)
  // a rerun skips everything but still fixes the verified flag of existing accounts
  await pool.query('UPDATE neon_auth."user" SET "emailVerified" = false')
  expect(await seedTestUsers(fakeAuth, DEV, SEED)).toEqual({ created: 0, skipped: 4 })
  expect(await count('SELECT count(*) n FROM neon_auth."user" WHERE "emailVerified"')).toBe(4)
  expect(await count(`SELECT count(*) n FROM providers WHERE ${OWNED}`)).toBe(2)
})

it('a run that crashed after the services (no photo, not published) resumes without adding the services twice', async () => {
  const owner = "(SELECT id FROM users WHERE email = 'anbieter.foto.berlin@example.com')"
  await pool.query(`UPDATE providers SET status = 'draft' WHERE owner_id = ${owner}`)
  await pool.query(`DELETE FROM photos WHERE owner_id = ${owner}`)
  expect(await seedTestUsers(fakeAuth, DEV, SEED)).toEqual({ created: 1, skipped: 3 })
  expect(await count(`SELECT count(*) n FROM services WHERE provider_id IN (SELECT id FROM providers WHERE ${OWNED})`)).toBe(3)
  expect(await count(`SELECT count(*) n FROM provider_references WHERE provider_id IN (SELECT id FROM providers WHERE ${OWNED})`)).toBe(2)
  expect(await count(`SELECT count(*) n FROM providers WHERE status = 'published' AND (SELECT count(*) FROM photos ph WHERE ph.owner_id = providers.owner_id AND ph.kind = 'profile' AND ph.provider_id IS NULL) = 1 AND owner_id = ${owner}`)).toBe(1)
})

it('placeholder photos: gives a published profile without a photo one; elsewhere needs the typed yes', async () => {
  await pool.query("DELETE FROM photos WHERE kind = 'profile' AND owner_id = (SELECT id FROM users WHERE email = 'anbieter.dj.hamburg@example.com')")
  expect(await addPlaceholderPhotos()).toBeGreaterThanOrEqual(1)
  expect(await count(`SELECT count(*) n FROM providers WHERE (SELECT count(*) FROM photos ph WHERE ph.owner_id = providers.owner_id AND ph.kind = 'profile' AND ph.provider_id IS NULL) = 1 AND ${OWNED}`)).toBe(2)
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
