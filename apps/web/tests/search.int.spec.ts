import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { distanceKm, pool } from '@kando/db'
import { SearchResultSchema } from '@kando/contract'
import { cleanupUsers, seedBase, seedProvider } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const route = await import('../app/app-api/v1/providers/route')

let categoryId: string
let docCategoryId: string
let otherCategoryId: string
let otherSlug: string
const origins = { exact: '90001', far: '90002', paging: '90003' }

const search = (query: string) =>
  route.GET(new Request(`http://localhost/app-api/v1/providers?${query}`), { params: Promise.resolve({}) })
const result = async (query: string) => {
  const res = await search(query)
  expect(res.status).toBe(200)
  return SearchResultSchema.parse(await res.json())
}
const slugs = async (query: string) => (await result(query)).items.map((i) => i.slug)

beforeAll(async () => {
  ;({ categoryId, docCategoryId } = await seedBase())
  otherSlug = `t7-other-${Date.now()}`
  otherCategoryId = (await pool.query('INSERT INTO categories (slug) VALUES ($1) RETURNING id', [otherSlug])).rows[0].id
  // Berlin fixture 10115 = (13.3, 52.5). Move due north by exactly 25 km, then 26 km.
  const kmPerDeg = (2 * Math.PI * 6371) / 360
  for (const [code, km] of [
    [origins.exact, 25],
    [origins.far, 26],
  ] as const) {
    const lat = 52.5 + km / kmPerDeg
    expect(distanceKm({ lat: 52.5, lng: 13.3 }, { lat, lng: 13.3 })).toBeCloseTo(km, 6)
    await pool.query(
      `INSERT INTO postcodes (country, code, place, state, location) VALUES ('DE', $1, 'Fixture', 'Berlin', ST_SetSRID(ST_MakePoint(13.3, $2), 4326))
       ON CONFLICT (country, code) DO UPDATE SET location = excluded.location`,
      [code, lat],
    )
  }
  await seedProvider('sx-near', { name: 'Anna Berlin', categoryId, skills: ['gardening', 'Pruning'] })
  await seedProvider('sx-remote', { name: 'Remote Rita', categoryId: otherCategoryId, postcode: null, remote: true, price: null })
  await seedProvider('sx-draft', { name: 'Draft Dora', categoryId, status: 'draft' })
  await seedProvider('sx-susp', { name: 'Suspended Sam', categoryId, suspended: true })
  await seedProvider('sx-nodocs', { name: 'Nodocs Nina', categoryId: docCategoryId })
})
afterAll(async () => {
  await cleanupUsers()
  await pool.query("DELETE FROM postcodes WHERE code IN ('90001', '90002', '90003')")
  await pool.query('DELETE FROM categories WHERE id = $1', [otherCategoryId])
})

it('radius edge and remote providers', async () => {
  const exact = await slugs(`postcode=${origins.exact}`)
  expect(exact).toContain('sx-near-slug') // exactly at the 25 km radius
  expect(exact).toContain('sx-remote-slug')
  const far = await slugs(`postcode=${origins.far}`)
  expect(far).not.toContain('sx-near-slug') // 26 km is outside
  expect(far).toContain('sx-remote-slug') // remote: any postcode
  expect(await slugs('postcode=10115')).toEqual(expect.arrayContaining(['sx-near-slug', 'sx-remote-slug']))
})

it('distance is whole km, at least 1, hidden for remote providers outside the radius', async () => {
  const res = await result('postcode=10115')
  const near = res.items.find((i) => i.slug === 'sx-near-slug')!
  expect(near).toMatchObject({ distanceKm: 1, fromPrice: 10, worksRemotely: false, publicName: 'Anna Berlin' })
  const exact = await result(`postcode=${origins.exact}`)
  expect(exact.items.find((i) => i.slug === 'sx-near-slug')!.distanceKm).toBe(25)
  const remote = res.items.find((i) => i.slug === 'sx-remote-slug')!
  expect(remote).toMatchObject({ distanceKm: null, fromPrice: null, worksRemotely: true })
  expect(res.items[0]!.slug).toBe('sx-near-slug') // nearest first
})

it('a draft, a suspended or a provider without an offerable service never appears', async () => {
  const all = await slugs('')
  expect(all).toEqual(expect.arrayContaining(['sx-near-slug', 'sx-remote-slug']))
  for (const s of ['sx-draft-slug', 'sx-susp-slug', 'sx-nodocs-slug']) expect(all).not.toContain(s)
  // once the document is approved the provider shows (eligibility reads documents with the owner connection)
  await pool.query("INSERT INTO documents (owner_id, requirement, key, status) VALUES ('sx-nodocs', 'police-certificate', 'k', 'approved')")
  expect(await slugs('')).toContain('sx-nodocs-slug')
})

it('category filter and q (public name and skills, case-insensitive)', async () => {
  expect(await slugs(`category=${otherSlug}`)).toEqual(['sx-remote-slug'])
  expect((await search('category=nope')).status).toBe(400)
  expect(await slugs('q=ANNA')).toEqual(['sx-near-slug'])
  expect(await slugs('q=pruning')).toEqual(['sx-near-slug'])
  expect(await slugs('q=zzzz')).toEqual([])
})

it('bad input is 400: unknown postcode, bad format, unknown country, unknown language, bad page', async () => {
  for (const q of ['postcode=99999', 'postcode=abc', 'country=XX', 'lang=fr', 'page=0']) {
    expect((await search(q)).status, q).toBe(400)
  }
})

it('paging: 20 per page and hasMore', async () => {
  for (let i = 0; i < 21; i++) {
    const n = String(i).padStart(2, '0')
    await seedProvider(`sx-pg${n}`, { name: `Pager ${n}`, categoryId, skills: ['pagingtest'] })
  }
  const p1 = await result('q=pagingtest')
  expect(p1).toMatchObject({ page: 1, hasMore: true })
  expect(p1.items).toHaveLength(20)
  const p2 = await result('q=pagingtest&page=2')
  expect(p2).toMatchObject({ page: 2, hasMore: false })
  expect(p2.items).toHaveLength(1)
  expect(new Set([...p1.items, ...p2.items].map((i) => i.slug)).size).toBe(21)
})
