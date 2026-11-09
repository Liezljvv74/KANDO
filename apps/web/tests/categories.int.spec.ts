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
    [`${tag}-a`, 'Ärzte', 'Zebra'],
    [`${tag}-b`, 'Backen', 'apples'],
    [`${tag}-z`, 'Zimmerei', 'Mango'],
    [`${tag}-o`, 'Öl', 'Oil'],
    [`${tag}-k`, 'Kinderbetreuung', null],
    ...(created ? ([['other-services', 'Sonstiges', 'Other services']] as const) : []),
  ] as const
  for (const [slug, de, en] of rows) {
    const id = (await pool.query('INSERT INTO categories (slug) VALUES ($1) RETURNING id', [slug])).rows[0].id
    await pool.query("INSERT INTO category_texts (category_id, lang, name) VALUES ($1, 'de', $2)", [id, de])
    if (en) await pool.query("INSERT INTO category_texts (category_id, lang, name) VALUES ($1, 'en', $2)", [id, en])
  }
})
afterAll(async () => {
  await pool.query('DELETE FROM categories WHERE slug LIKE $1', [`${tag}-%`])
  if (created) await pool.query("DELETE FROM categories WHERE slug = 'other-services'")
})

const get = (q = '') => route.GET(new Request(`http://localhost/app-api/v1/categories${q}`), { params: Promise.resolve({}) })

it('alphabetical in the language of the request (umlauts with their base letter), "other services" always last', async () => {
  const names = async (q: string) => {
    const list = CategorySchema.array().parse(await (await get(q)).json())
    expect(list.at(-1)!.slug).toBe('other-services')
    return list.filter((c) => c.slug.startsWith(tag)).map((c) => c.name)
  }
  expect(await names('')).toEqual(['Ärzte', 'Backen', 'Kinderbetreuung', 'Öl', 'Zimmerei'])
  // English: missing English falls back to German; case-insensitive
  expect(await names('?lang=en')).toEqual(['apples', 'Kinderbetreuung', 'Mango', 'Oil', 'Zebra'])
})

it('an unknown language is 400', async () => {
  const res = await get('?lang=fr')
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: 'Unknown language' })
})
