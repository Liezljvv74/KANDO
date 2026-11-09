import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { asUser, pool } from '@kando/db'
import { HELP_GROUPS, HELP_OPENING_SLUG, HelpTopicSchema } from '@kando/contract'
import { helpTopics, seedHelpTopics } from '@kando/domain'
import { sql } from 'drizzle-orm'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const route = await import('../app/app-api/v1/help/route')

const get = (q = '', headers: Record<string, string> = {}) => route.GET(new Request(`http://localhost/app-api/v1/help${q}`, { headers }), { params: Promise.resolve({}) })
const count = async () => Number((await pool.query('SELECT count(*) n FROM help_topics')).rows[0].n)
const ROW = `('t-extra', 99, 'your-data', 'Titel', 'Text', 'Title', 'Text', true)`

beforeAll(async () => {
  await pool.query('DELETE FROM help_topics')
})
afterAll(async () => {
  await pool.query('DELETE FROM help_topics')
})

it('the seed is idempotent: it inserts every topic once, touches nothing on a re-run, and keeps the owner\'s approval', async () => {
  const n = await seedHelpTopics()
  expect(n).toBe(helpTopics().length)
  expect(await count()).toBe(n)
  const before = (await pool.query('SELECT slug, updated_at FROM help_topics ORDER BY slug')).rows
  expect(await seedHelpTopics()).toBe(n)
  expect(await count()).toBe(n)
  expect((await pool.query('SELECT slug, updated_at FROM help_topics ORDER BY slug')).rows).toEqual(before) // matching rows are not touched
  // the owner approves a hidden topic and hides a published one: a re-seed keeps both, but a changed text is written
  await pool.query("UPDATE help_topics SET approved = true WHERE slug = 'where-the-money-is-kept'")
  await pool.query("UPDATE help_topics SET approved = false, title_en = 'old' WHERE slug = 'finding-providers'")
  await seedHelpTopics()
  const rows = (await pool.query("SELECT slug, approved, title_en FROM help_topics WHERE slug IN ('where-the-money-is-kept', 'finding-providers') ORDER BY slug")).rows
  expect(rows).toEqual([
    { slug: 'finding-providers', approved: false, title_en: 'Finding providers' },
    { slug: 'where-the-money-is-kept', approved: true, title_en: 'Where the money is kept' },
  ])
  await pool.query("UPDATE help_topics SET approved = false WHERE slug = 'where-the-money-is-kept'")
  await pool.query("UPDATE help_topics SET approved = true WHERE slug = 'finding-providers'")
})

it('GET /help works signed out, returns German and English topics in order, and only approved ones', async () => {
  const de = HelpTopicSchema.array().parse(await (await get()).json())
  const en = HelpTopicSchema.array().parse(await (await get('?lang=en')).json())
  const approved = helpTopics().filter((t) => t.approved)
  expect(de.map((t) => t.slug)).toEqual(approved.map((t) => t.slug)) // sort order of the seed
  expect(de[0]!.slug).toBe(HELP_OPENING_SLUG)
  expect(en.map((t) => t.slug)).toEqual(de.map((t) => t.slug))
  expect(de[0]!.title).toBe('Was KANDO ist und wie es funktioniert')
  expect(en[0]!.title).toBe('What KANDO is and how it works')
  expect(de.every((t) => (HELP_GROUPS as readonly string[]).includes(t.group))).toBe(true)
  // hidden until approved
  const slugs = de.map((t) => t.slug)
  expect(slugs).not.toContain('how-it-is-governed')
  expect(slugs).not.toContain('where-the-money-is-kept')
  // signed in gives the same answer
  const signedIn = await (await get('', { cookie: 'uid=help-u1:help-u1@test.skilled.invalid' })).json()
  expect(signedIn).toEqual(de)
})

it('approving a topic shows it, with both languages', async () => {
  await pool.query("UPDATE help_topics SET approved = true WHERE slug = 'how-it-is-governed'")
  try {
    const en = HelpTopicSchema.array().parse(await (await get('?lang=en')).json())
    expect(en.find((t) => t.slug === 'how-it-is-governed')?.title).toBe('How it is governed')
  } finally {
    await pool.query("UPDATE help_topics SET approved = false WHERE slug = 'how-it-is-governed'")
  }
})

it('an unknown language is 400', async () => {
  const res = await get('?lang=fr')
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: 'Unknown language' })
})

it('the table refuses an empty title or body in either language, and an unknown group', async () => {
  const insert = (v: string) => pool.query(`INSERT INTO help_topics (slug, sort, "group", title_de, body_de, title_en, body_en, approved) VALUES ${v}`)
  for (const bad of [`('t-bad', 98, 'your-data', '', 'Text', 'Title', 'Text', true)`, `('t-bad', 98, 'your-data', 'Titel', '  ', 'Title', 'Text', true)`, `('t-bad', 98, 'your-data', 'Titel', 'Text', '', 'Text', true)`, `('t-bad', 98, 'your-data', 'Titel', 'Text', 'Title', '', true)`, `('t-bad', 98, 'nonsense', 'Titel', 'Text', 'Title', 'Text', true)`])
    await expect(insert(bad), bad).rejects.toThrow()
  await insert(ROW)
  await pool.query("DELETE FROM help_topics WHERE slug = 't-extra'")
})

it('every seeded topic has a non-empty German and English title and body', async () => {
  await seedHelpTopics()
  const { rows } = await pool.query("SELECT slug FROM help_topics WHERE btrim(title_de) = '' OR btrim(body_de) = '' OR btrim(title_en) = '' OR btrim(body_en) = ''")
  expect(rows).toEqual([])
})

it('app_user reads help_topics (also signed out) but cannot write them', async () => {
  const denied = (q: ReturnType<typeof sql>) => expect(asUser(null, (tx) => tx.execute(q))).rejects.toMatchObject({ cause: { message: expect.stringContaining('permission denied') } })
  expect((await asUser(null, (tx) => tx.execute(sql`SELECT slug FROM help_topics LIMIT 1`))).rows.length).toBeGreaterThan(0)
  await denied(sql`INSERT INTO help_topics (slug, sort, "group", title_de, body_de, title_en, body_en) VALUES ('t-app', 1, 'your-data', 'a', 'b', 'c', 'd')`)
  await denied(sql`UPDATE help_topics SET approved = true`)
  await denied(sql`DELETE FROM help_topics`)
})
