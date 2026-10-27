import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { CategorySchema } from '@kando/contract'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const route = await import('../app/app-api/v1/categories/route')

let created = false
const tag = `t7c${Date.now()}`
beforeAll(async () => {
  // the real 'other-services' row may exist (seed): keep it, and remove it afterwards only if this test created it
  created = (await pool.query("SELECT 1 FROM categories WHERE slug = 'other-services'")).rows.length === 0
  const rows = [
    [`${tag}-cleaning`, 10, 'Reinigung', 'Cleaning'],
    [`${tag}-babysitting`, 20, 'Kinderbetreuung', null],
    ...(created ? ([['other-services', 5, 'Sonstiges', 'Other services']] as const) : []),
  ] as const
  for (const [slug, sort, de, en] of rows) {
    const id = (await pool.query('INSERT INTO categories (slug, sort) VALUES ($1, $2) RETURNING id', [slug, sort])).rows[0].id
    await pool.query("INSERT INTO category_texts (category_id, lang, name) VALUES ($1, 'de', $2)", [id, de])
    if (en) await pool.query("INSERT INTO category_texts (category_id, lang, name) VALUES ($1, 'en', $2)", [id, en])
  }
})
afterAll(async () => {
  await pool.query('DELETE FROM categories WHERE slug LIKE $1', [`${tag}-%`])
  if (created) await pool.query("DELETE FROM categories WHERE slug = 'other-services'")
})

const get = (q = '') => route.GET(new Request(`http://localhost/app-api/v1/categories${q}`), { params: Promise.resolve({}) })

it('ordered by sort, "other services" always last, names in the requested language, anonymous allowed', async () => {
  const res = await get('?lang=en')
  expect(res.status).toBe(200)
  const list = CategorySchema.array().parse(await res.json())
  const mine = list.filter((c) => c.slug === 'other-services' || c.slug.startsWith(tag))
  expect(mine.map((c) => c.slug)).toEqual([`${tag}-cleaning`, `${tag}-babysitting`, 'other-services'])
  expect(list.at(-1)!.slug).toBe('other-services')
  expect(mine.slice(0, 2).map((c) => c.name)).toEqual(['Cleaning', 'Kinderbetreuung']) // missing English falls back to German
  const de = CategorySchema.array().parse(await (await get()).json())
  expect(de.find((c) => c.slug === `${tag}-cleaning`)!.name).toBe('Reinigung')
})

it('an unknown language is 400', async () => {
  const res = await get('?lang=fr')
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: 'Unknown language' })
})
