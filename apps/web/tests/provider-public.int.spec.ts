import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { ProviderDetailSchema } from '@kando/contract'
import { setStorageForTests } from '@kando/domain'
import { cleanupUsers, EMAIL, givePhoto, memoryStorage, seedBase, seedProvider } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const route = await import('../app/app-api/v1/providers/[slug]/route')

let categoryId: string
let docCategoryId: string
beforeAll(async () => {
  setStorageForTests(memoryStorage())
  ;({ categoryId, docCategoryId } = await seedBase())
  const id = await seedProvider('pp-a', { name: 'Anna H.', categoryId })
  await pool.query("INSERT INTO services (provider_id, category_id, title, price_type) VALUES ($1, $2, 'Hidden until check', 'on-request')", [id, docCategoryId])
  await pool.query("INSERT INTO provider_references (provider_id, client_name, description, year) VALUES ($1, 'Acme', 'Great', 2024)", [id])
  await givePhoto('pp-a')
  await pool.query(
    "INSERT INTO photos (owner_id, provider_id, kind, key, width, height) VALUES ('pp-a', $1, 'portfolio', 'providers/p/one.jpg', 1, 1)",
    [id],
  )
  await seedProvider('pp-draft', { name: 'Draft', categoryId, status: 'draft' })
  await seedProvider('pp-nodocs', { name: 'No Docs', categoryId: docCategoryId })
})
afterAll(async () => {
  setStorageForTests(undefined)
  await cleanupUsers()
})

const get = (slug: string, q = '') =>
  route.GET(new Request(`http://localhost/app-api/v1/providers/${slug}${q}`), { params: Promise.resolve({ slug }) })

it('a published provider page: contract shape, place, photo urls, only offerable services', async () => {
  const res = await get('pp-a-slug', '?lang=en')
  expect(res.status).toBe(200)
  const raw = await res.json()
  const text = JSON.stringify(raw)
  for (const key of ['id', 'ownerId', 'owner_id', 'basePostcode', 'base_postcode', 'location', 'status', 'suspended']) {
    expect(Object.keys(raw), key).not.toContain(key)
  }
  expect(text).not.toContain('10115')
  expect(text).not.toMatch(/"(owner\w*|location|status|suspended|base_?[pP]ostcode)":/)
  const p = ProviderDetailSchema.parse(raw)
  expect(p).toMatchObject({
    slug: 'pp-a-slug',
    publicName: 'Anna H.',
    place: 'Berlin',
    photoUrl: 'https://media.test/users/pp-a/profile.jpg',
    translatable: true,
    isNew: true,
  })
  expect(p.services.map((s) => s.title)).toEqual(['Anna H. service']) // the document-gated service is not shown
  expect(p.categories).toHaveLength(1)
  expect(p.references).toEqual([expect.objectContaining({ clientName: 'Acme', year: 2024 })])
  expect(p.photos).toEqual([expect.objectContaining({ url: 'https://media.test/providers/p/one.jpg', alt: 'Anna H.' })])
})

it('404 when not visible: unknown, draft, or no offerable service', async () => {
  for (const s of ['nope', 'pp-draft-slug', 'pp-nodocs-slug']) {
    expect((await get(s)).status, s).toBe(404)
  }
})

it('a draft page is a 404 for its own owner too', async () => {
  const res = await route.GET(
    new Request('http://localhost/app-api/v1/providers/pp-draft-slug', { headers: { cookie: `uid=pp-draft:${EMAIL('pp-draft')}` } }),
    { params: Promise.resolve({ slug: 'pp-draft-slug' }) },
  )
  expect(res.status).toBe(404)
})

it('unknown language is 400', async () => {
  expect((await get('pp-a-slug', '?lang=fr')).status).toBe(400)
})

it("anonymous: the page carries the owner's profile photo and the public name, no display name", async () => {
  await seedProvider('pp-lena', { name: 'Lena F.', categoryId })
  await givePhoto('pp-lena')
  const raw = await (await get('pp-lena-slug')).json()
  expect(raw).not.toHaveProperty('displayName')
  expect(ProviderDetailSchema.parse(raw)).toMatchObject({ publicName: 'Lena F.', photoUrl: 'https://media.test/users/pp-lena/profile.jpg' })
})
