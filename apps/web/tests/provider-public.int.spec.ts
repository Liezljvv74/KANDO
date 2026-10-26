import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { ProviderDetailSchema } from '@kando/contract'
import { setStorageForTests } from '@kando/domain'
import { cleanupUsers, memoryStorage, seedBase, seedProvider } from './helpers'

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
  const prof = await pool.query(
    "INSERT INTO photos (owner_id, provider_id, kind, key, width, height) VALUES ('pp-a', $1, 'profile', 'providers/p/profile.jpg', 1, 1) RETURNING id",
    [id],
  )
  await pool.query('UPDATE providers SET photo_id = $1 WHERE id = $2', [prof.rows[0].id, id])
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
  const p = ProviderDetailSchema.parse(await res.json())
  expect(p).toMatchObject({
    slug: 'pp-a-slug',
    publicName: 'Anna H.',
    place: 'Berlin',
    photoUrl: 'https://media.test/providers/p/profile.jpg',
    translatable: false,
    isNew: true,
  })
  expect(p.services.map((s) => s.title)).toEqual(['Anna H. service']) // the document-gated service is not shown
  expect(p.categories).toHaveLength(1)
  expect(p.references).toEqual([expect.objectContaining({ clientName: 'Acme', year: 2024 })])
  expect(p.photos).toEqual([expect.objectContaining({ url: 'https://media.test/providers/p/one.jpg', alt: 'Anna H.' })])
  expect(JSON.stringify(p)).not.toMatch(/10115|owner|suspended|pp-a@/)
})

it('404 when not visible: unknown, draft, or no offerable service', async () => {
  for (const s of ['nope', 'pp-draft-slug', 'pp-nodocs-slug']) {
    expect((await get(s)).status, s).toBe(404)
  }
})

it('unknown language is 400', async () => {
  expect((await get('pp-a-slug', '?lang=fr')).status).toBe(400)
})
