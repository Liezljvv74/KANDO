import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { importPostcodes, pool } from '@kando/db'
import { seedCategories } from '@kando/db/src/seed/categories'
import { addPlaceholderPhotos, confirmedOrDev } from '@kando/db/src/seed/placeholder-photos'
import { assertDevBranch, seedTestUsers, TEST_PASSWORD } from '@kando/db/src/seed/test-users'
import { setStorageForTests } from '@kando/domain'
import { memoryStorage } from './helpers'

const file = resolve(__dirname, '../../../packages/db/data/postcodes-de.tsv')
const storage = memoryStorage()
const ids = new Map<string, string>() // like Neon Auth: the same email gives the same account
const fakeAuth = { signUp: async (email: string) => ({ id: ids.get(email) ?? ids.set(email, randomUUID()).get(email)! }) }
const count = async (sql: string) => Number((await pool.query(sql)).rows[0].n)

beforeAll(async () => {
  setStorageForTests(storage)
  await importPostcodes('DE', file)
})
afterAll(async () => {
  setStorageForTests(undefined)
  await pool.query("DELETE FROM photos WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%@example.com')")
  await pool.query("DELETE FROM providers WHERE owner_id IN (SELECT id FROM users WHERE email LIKE '%@example.com')")
  await pool.query("DELETE FROM users WHERE email LIKE '%@example.com'")
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

it('the test-user seed refuses on any branch but kando-dev or dev', () => {
  expect(() => assertDevBranch('main')).toThrow(/dev branch/)
  expect(() => assertDevBranch(undefined)).toThrow()
  expect(() => assertDevBranch('kando-dev')).not.toThrow()
  expect(() => assertDevBranch('dev')).not.toThrow()
  expect(TEST_PASSWORD).toBe('TestPass123')
})

it('builds the test users through the domain: published providers with photo, services, public names; a rerun adds nothing', async () => {
  const first = await seedTestUsers(fakeAuth)
  expect(first).toEqual({ created: 14, skipped: 0 })
  expect(await count("SELECT count(*) n FROM users WHERE email LIKE '%@example.com'")).toBe(14)
  expect(await count("SELECT count(*) n FROM providers WHERE status = 'published' AND photo_id IS NOT NULL")).toBe(9)
  expect(storage.objects.size).toBe(9)
  const dj = (await pool.query("SELECT public_name, slug FROM providers WHERE business_name = 'Nordbeat Events GmbH'")).rows[0]
  expect(dj).toEqual({ public_name: 'Nordbeat Events GmbH', slug: 'nordbeat-events-gmbh' })
  const foto = (await pool.query("SELECT public_name FROM providers p JOIN users u ON u.id = p.owner_id WHERE u.email = 'anbieter.foto.berlin@example.com'")).rows[0]
  expect(foto.public_name).toBe('Lena F.')
  expect(await count('SELECT count(*) n FROM services')).toBe(14)
  expect(await seedTestUsers(fakeAuth)).toEqual({ created: 0, skipped: 14 })
  expect(await count('SELECT count(*) n FROM providers')).toBe(9)
})

it('placeholder photos: gives a published profile without a photo one; elsewhere needs the typed yes', async () => {
  const email = 'anbieter.gassi.leipzig@example.com'
  await pool.query("UPDATE providers SET photo_id = NULL WHERE owner_id = (SELECT id FROM users WHERE email = $1)", [email])
  expect(await addPlaceholderPhotos()).toBe(1)
  expect(await count("SELECT count(*) n FROM providers WHERE photo_id IS NOT NULL")).toBe(9)
  expect(await addPlaceholderPhotos()).toBe(0)
  const ask = (answer: string) => async () => answer
  await expect(confirmedOrDev('kando-dev', {}, ask('yes'))).resolves.toBeUndefined()
  await expect(confirmedOrDev('main', {}, ask('yes'))).rejects.toThrow(/ALLOW_PRODUCTION/)
  await expect(confirmedOrDev('main', { ALLOW_PRODUCTION: '1' }, ask('no'))).rejects.toThrow(/Cancelled/)
  await expect(confirmedOrDev('main', { ALLOW_PRODUCTION: '1' }, ask('yes'))).resolves.toBeUndefined()
})
