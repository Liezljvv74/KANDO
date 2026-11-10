import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { asUser, db, pool } from '@kando/db'
import { HELP_GROUPS, HelpTopicSchema } from '@kando/contract'
import { EMBEDDING_MODEL, helpTopics, seedHelpTopics } from '@kando/domain'
import { sql } from 'drizzle-orm'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const route = await import('../app/app-api/v1/help/route')

// Specs may share a database with real topics: this file inserts and deletes only its own rows (slug prefix) and asserts only on them.
const P = 'test-help-'
const get = (q = '', headers: Record<string, string> = {}) => route.GET(new Request(`http://localhost/app-api/v1/help${q}`, { headers }), { params: Promise.resolve({}) })
const mine = async (q = '', headers: Record<string, string> = {}) => HelpTopicSchema.array().parse(await (await get(q, headers)).json()).filter((t) => t.slug.startsWith(P))
const insert = (slug: string, sort: number, approved: boolean, group = 'your-data') =>
  pool.query(`INSERT INTO help_topics (slug, sort, "group", title_de, body_de, title_en, body_en, approved) VALUES ($1, $2, $3, $4, 'Text DE', $5, 'Text EN', $6)`, [P + slug, sort, group, `Titel ${slug}`, `Title ${slug}`, approved])
const clean = () => pool.query('DELETE FROM help_topics WHERE slug LIKE $1', [`${P}%`])

beforeAll(async () => {
  await clean()
  await insert('b', 2, true)
  await insert('a', 1, true)
  await insert('hidden', 3, false)
})
afterAll(clean)

it('GET /help works signed out and in, returns German and English in order, and only approved topics', async () => {
  const de = await mine()
  const en = await mine('?lang=en')
  expect(de.map((t) => t.slug)).toEqual([`${P}a`, `${P}b`]) // sort order, the hidden one left out
  expect(en.map((t) => t.slug)).toEqual(de.map((t) => t.slug))
  expect(de[0]!.title).toBe('Titel a')
  expect(en[0]!.title).toBe('Title a')
  expect(de[0]!.body).toBe('Text DE')
  expect(en[0]!.body).toBe('Text EN')
  expect(await mine('', { cookie: 'uid=help-u1:help-u1@test.skilled.invalid' })).toEqual(de)
})

it('approving a topic shows it', async () => {
  await pool.query('UPDATE help_topics SET approved = true WHERE slug = $1', [`${P}hidden`])
  try {
    expect((await mine('?lang=en')).map((t) => t.slug)).toContain(`${P}hidden`)
  } finally {
    await pool.query('UPDATE help_topics SET approved = false WHERE slug = $1', [`${P}hidden`])
  }
})

it('an unknown language is 400', async () => {
  const res = await get('?lang=fr')
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: 'Unknown language' })
})

it('the table refuses an empty title or body in either language, and an unknown group', async () => {
  const bad = (cols: [string, string, string, string], group = 'your-data') =>
    pool.query(`INSERT INTO help_topics (slug, sort, "group", title_de, body_de, title_en, body_en, approved) VALUES ($1, 98, $2, $3, $4, $5, $6, true)`, [`${P}bad`, group, ...cols])
  for (const cols of [['', 'T', 'T', 'T'], ['T', '  ', 'T', 'T'], ['T', 'T', '', 'T'], ['T', 'T', 'T', '']] as [string, string, string, string][]) await expect(bad(cols)).rejects.toThrow()
  await expect(bad(['T', 'T', 'T', 'T'], 'nonsense')).rejects.toThrow()
  expect(HELP_GROUPS).toContain('your-data')
})

it('app_user reads help_topics (also signed out) but cannot write them', async () => {
  const denied = (q: ReturnType<typeof sql>) => expect(asUser(null, (tx) => tx.execute(q))).rejects.toMatchObject({ cause: { message: expect.stringContaining('permission denied') } })
  expect((await asUser(null, (tx) => tx.execute(sql`SELECT slug FROM help_topics WHERE slug = ${P + 'a'}`))).rows).toHaveLength(1)
  await denied(sql`INSERT INTO help_topics (slug, sort, "group", title_de, body_de, title_en, body_en) VALUES ('test-help-app', 1, 'your-data', 'a', 'b', 'c', 'd')`)
  await denied(sql`UPDATE help_topics SET approved = true WHERE slug LIKE 'test-help-%'`)
  await denied(sql`DELETE FROM help_topics WHERE slug LIKE 'test-help-%'`)
})

// The real seed touches every row of the table, so it runs inside a transaction that is rolled back: nothing real is changed or lost.
it('the seed (rolled back): inserts every topic, is idempotent, keeps approval, writes changed text, removes retired topics, non-empty in both languages', async () => {
  const ROLLBACK = new Error('rollback')
  const codeSlugs = helpTopics().map((t) => t.slug)
  const result = db
    .transaction(async (tx) => {
      const q = async (text: string, params: unknown[] = []) => (await tx.execute(sql.raw(text.replace(/\$(\d)/g, (_, i) => `'${String(params[Number(i) - 1]).replaceAll("'", "''")}'`)))).rows
      await tx.execute(sql`DELETE FROM help_topics`)
      await tx.execute(sql`INSERT INTO help_topics (slug, sort, "group", title_de, body_de, title_en, body_en) VALUES ('retired-topic', 1, 'your-data', 'a', 'b', 'c', 'd')`)
      const first = await seedHelpTopics(tx as never, null)
      expect(first).toMatchObject({ upserted: codeSlugs.length, removed: 1 })
      expect(first.months).toBeGreaterThanOrEqual(0)
      expect(await q('SELECT slug FROM help_topics ORDER BY slug')).toHaveLength(codeSlugs.length)
      const before = await q('SELECT slug, updated_at FROM help_topics ORDER BY slug')
      expect(await seedHelpTopics(tx as never, null)).toMatchObject({ removed: 0 })
      expect(await q('SELECT slug, updated_at FROM help_topics ORDER BY slug')).toEqual(before) // matching rows are not touched
      await tx.execute(sql`UPDATE help_topics SET approved = true WHERE slug = 'where-the-money-is-kept'`)
      await tx.execute(sql`UPDATE help_topics SET approved = false, title_en = 'old' WHERE slug = 'finding-providers'`)
      await seedHelpTopics(tx as never, null)
      expect(await q("SELECT slug, approved, title_en FROM help_topics WHERE slug IN ('where-the-money-is-kept', 'finding-providers') ORDER BY slug")).toEqual([
        { slug: 'finding-providers', approved: false, title_en: 'Finding providers' },
        { slug: 'where-the-money-is-kept', approved: true, title_en: 'Where the money is kept' },
      ])
      expect(await q("SELECT slug FROM help_topics WHERE btrim(title_de) = '' OR btrim(body_de) = '' OR btrim(title_en) = '' OR btrim(body_en) = ''")).toEqual([])
      throw ROLLBACK
    })
    .catch((e) => {
      if (e !== ROLLBACK) throw e
    })
  await result
})

it('the seed (rolled back) writes search vectors with the model name, skips unchanged topics, rebuilds on a changed text or model, and still seeds without an embedder', async () => {
  const ROLLBACK = new Error('rollback')
  const codeSlugs = helpTopics().map((t) => t.slug)
  const calls: number[] = []
  const fake = async (texts: string[]) => {
    calls.push(texts.length)
    return texts.map(() => [1, 2, 3])
  }
  await db
    .transaction(async (tx) => {
      const q = async (text: string) => (await tx.execute(sql.raw(text))).rows
      await tx.execute(sql`DELETE FROM help_topics`)
      expect(await seedHelpTopics(tx as never, null)).toMatchObject({ embedded: 0, embedNote: 'no embeddings (no key)' }) // topics are written without vectors
      expect(await q('SELECT slug FROM help_topics WHERE embedding_de IS NOT NULL')).toEqual([])
      expect(await seedHelpTopics(tx as never, fake)).toMatchObject({ embedded: codeSlugs.length })
      expect(calls).toEqual([codeSlugs.length * 2])
      expect(await q(`SELECT count(*)::int AS n FROM help_topics WHERE embedding_de = '[1,2,3]' AND embedding_en = '[1,2,3]' AND embedding_model = '${EMBEDDING_MODEL}'`)).toEqual([{ n: codeSlugs.length }])
      expect(await seedHelpTopics(tx as never, fake)).toMatchObject({ embedded: 0, embedNote: 'all embeddings up to date' })
      expect(calls).toHaveLength(1) // nothing changed: no second call
      await tx.execute(sql`UPDATE help_topics SET body_de = 'old', embedding_model = 'other-model' WHERE slug = 'quotes'`)
      await tx.execute(sql`UPDATE help_topics SET title_en = 'old' WHERE slug = 'paying'`)
      expect(await seedHelpTopics(tx as never, async () => {
        throw new Error('down')
      })).toMatchObject({ embedded: 0, embedNote: 'no embeddings (the embedding call failed)' })
      // changed text lost its vector of that language; the other language keeps it
      expect(await q("SELECT slug, embedding_de IS NULL AS de_null, embedding_en IS NULL AS en_null FROM help_topics WHERE slug IN ('quotes', 'paying') ORDER BY slug")).toEqual([
        { slug: 'paying', de_null: false, en_null: true },
        { slug: 'quotes', de_null: true, en_null: false },
      ])
      expect(await seedHelpTopics(tx as never, fake)).toMatchObject({ embedded: 2 })
      expect(await q("SELECT count(*)::int AS n FROM help_topics WHERE embedding_de IS NULL OR embedding_en IS NULL OR embedding_model <> '" + EMBEDDING_MODEL + "'")).toEqual([{ n: 0 }])
      throw ROLLBACK
    })
    .catch((e) => {
      if (e !== ROLLBACK) throw e
    })
})
