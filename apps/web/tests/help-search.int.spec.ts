import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { EMBEDDING_MODEL, ipHashOf } from '@kando/domain'
import { cleanupUsers, EMAIL, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const route = await import('../app/app-api/v1/help/search/route')

// The database may hold real topics: this file inserts and deletes only its own rows (slug prefix) and looks only at them.
// The embedding service is faked at fetch: "money back" wording gets one vector, everything else an unrelated one.
const P = 'test-help-'
const stamp = Date.now()
let n = 0
const newIp = () => `198.51.100.${(stamp + ++n) % 250}-${stamp}-${n}`
const embedCalls = vi.fn()

const search = async (q: string, o: { lang?: string; uid?: string; ip?: string } = {}) => {
  const url = `http://localhost/app-api/v1/help/search?q=${encodeURIComponent(q)}${o.lang === undefined ? '' : `&lang=${o.lang}`}`
  const res = await route.GET(
    new Request(url, { headers: { 'x-vercel-forwarded-for': o.ip ?? newIp(), ...(o.uid ? { cookie: `uid=${o.uid}:${EMAIL(o.uid)}` } : {}) } }),
    { params: Promise.resolve({}) },
  )
  const body = await res.json()
  return { status: res.status, body, mine: (body.topics ?? []).filter((t: { slug: string }) => t.slug.startsWith(P)).map((t: { slug: string }) => t.slug.slice(P.length)) as string[] }
}
const insert = (slug: string, approved: boolean, de: [string, string], en: [string, string], vector: number[] | null = null) =>
  pool.query(
    `INSERT INTO help_topics (slug, sort, "group", title_de, body_de, title_en, body_en, approved, embedding_de, embedding_en, embedding_model) VALUES ($1, 500, 'your-data', $2, $3, $4, $5, $6, $7, $7, $8)`,
    [P + slug, ...de, ...en, approved, vector && JSON.stringify(vector), vector && EMBEDDING_MODEL],
  )
const clean = async () => {
  await pool.query('DELETE FROM help_topics WHERE slug LIKE $1', [`${P}%`])
  await pool.query("DELETE FROM translation_requests WHERE client_key LIKE 'help-search:%'")
}

beforeAll(async () => {
  await clean()
  await insert('refund', true, ['Rückerstattung bekommen', 'Wird ein Auftrag rechtzeitig abgesagt, wird der Preis erstattet.'], ['Getting a refund', 'If a job is cancelled in time, the price is returned to you.'])
  await insert('commission', true, ['Provision und Gebühren', 'Der Anbieter zahlt einen Teil des Preises.'], ['Commission and fees', 'The provider pays a share of the price.'])
  await insert('hidden', false, ['Rückerstattung Geheimnis', 'Provision Geheimnis'], ['Refund secret', 'Commission secret'])
  await insert('meaning', true, ['Im Programm bezahlen', 'Kartenzahlung ueber den Zahlungsdienst.'], ['Paying in the app', 'Card payment through the payment service.'], [1, 0, 0])
})
beforeEach(() => {
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'test-secret-not-real-0123')
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key-not-real')
  embedCalls.mockReset()
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    const input = JSON.parse(init.body).input as string[]
    embedCalls(input)
    return Response.json({ data: input.map((t, index) => ({ index, embedding: /money back|Geld zurück/i.test(t) ? [1, 0, 0] : [0, 0, 1] })) })
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
afterAll(async () => {
  await clean()
  await pool.query("DELETE FROM translation_requests WHERE client_key LIKE 'help-search:user:hs-%'")
  await cleanupUsers()
})

it('exact words are found by keyword in both languages: refund, Rückerstattung, commission, Provision', async () => {
  expect((await search('refund', { lang: 'en' })).mine).toEqual(['refund'])
  expect((await search('Rückerstattung', { lang: 'de' })).mine).toEqual(['refund'])
  expect((await search('commission', { lang: 'en' })).mine).toEqual(['commission'])
  expect((await search('Provision', { lang: 'de' })).mine).toEqual(['commission'])
})

it('German word stems, umlauts, compounds in a title and prefixes are found', async () => {
  expect((await search('rueckerstattung', { lang: 'de' })).mine).toEqual([]) // not a spelling we promise
  expect((await search('Erstattung', { lang: 'de' })).mine).toEqual(['refund']) // inside the compound title
  expect((await search('Provisi', { lang: 'de' })).mine).toEqual(['commission']) // title prefix
  expect((await search('Gebühr', { lang: 'de' })).mine).toEqual(['commission'])
  expect((await search('REFUNDS', { lang: 'en' })).mine).toEqual(['refund']) // stem, any case
})

it('the answer holds only the topics, with no scores; the language decides the text', async () => {
  const r = await search('refund', { lang: 'en' })
  expect(Object.keys(r.body)).toEqual(['topics'])
  const topic = r.body.topics.find((t: { slug: string }) => t.slug === `${P}refund`)
  expect(Object.keys(topic).sort()).toEqual(['body', 'group', 'slug', 'sort', 'title'])
  expect(topic.title).toBe('Getting a refund')
  expect((await search('refund', { lang: 'de' })).mine).toEqual([]) // a German search never returns a topic found only through its English text
  expect((await search('Provision')).mine).toEqual(['commission']) // default language is German
})

it('an unapproved topic is never returned, by keyword or meaning, and approving it shows it', async () => {
  for (const [q, lang] of [['Refund secret', 'en'], ['Geheimnis', 'de'], ['secret', 'en']]) expect((await search(q!, { lang })).mine).toEqual([])
  await pool.query('UPDATE help_topics SET approved = true WHERE slug = $1', [`${P}hidden`])
  try {
    expect((await search('secret', { lang: 'en' })).mine).toEqual(['hidden'])
  } finally {
    await pool.query('UPDATE help_topics SET approved = false WHERE slug = $1', [`${P}hidden`])
  }
})

it('related wording with no shared word is found by meaning; unrelated text returns nothing', async () => {
  const money = await search('when do I get my money back', { lang: 'en' })
  expect(money.mine).toEqual(['meaning'])
  expect(embedCalls).toHaveBeenCalledWith(['when do I get my money back'])
  expect((await search('Wann bekomme ich mein Geld zurück', { lang: 'de' })).mine).toEqual(['meaning'])
  expect((await search('pizza recipe', { lang: 'en' })).mine).toEqual([])
})

it('a missing key or a failing embedding call gives the keyword results, not an error', async () => {
  vi.stubEnv('OPENROUTER_API_KEY', '')
  const noKey = await search('refund', { lang: 'en' })
  expect(noKey.status).toBe(200)
  expect(noKey.mine).toEqual(['refund'])
  expect((await search('when do I get my money back', { lang: 'en' })).mine).toEqual([]) // meaning needs the key
  expect(embedCalls).not.toHaveBeenCalled()
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key-not-real')
  vi.stubGlobal('fetch', async () => new Response('down', { status: 500 }))
  const failing = await search('commission', { lang: 'en' })
  expect(failing.status).toBe(200)
  expect(failing.mine).toEqual(['commission'])
})

it('when the global daily budget is used up the keyword part still answers and no embedding call is made', async () => {
  vi.stubEnv('HELP_SEARCH_GLOBAL_LIMIT_PER_DAY', '1')
  await search('refund', { lang: 'en' })
  const r = await search('when do I get my money back', { lang: 'en' })
  expect(r.status).toBe(200)
  expect(r.mine).toEqual([])
  expect(embedCalls).not.toHaveBeenCalled()
  expect((await search('refund', { lang: 'en' })).mine).toEqual(['refund'])
})

it('the search text must be 2 to 100 characters after trimming; an unknown language is 400; none of it is counted', async () => {
  const before = (await pool.query("SELECT count(*)::int AS n FROM translation_requests WHERE client_key LIKE 'help-search:%'")).rows[0].n
  for (const q of ['', ' ', 'a', ' a ', 'x'.repeat(101)]) expect((await search(q, { lang: 'en' })).status, JSON.stringify(q.slice(0, 5))).toBe(400)
  expect((await search('refund', { lang: 'fr' })).status).toBe(400)
  expect((await search('ü'.repeat(100), { lang: 'de' })).status).toBe(200) // counted in characters, not bytes
  expect((await search('  ab  ', { lang: 'de' })).status).toBe(200)
  expect((await pool.query("SELECT count(*)::int AS n FROM translation_requests WHERE client_key LIKE 'help-search:%'")).rows[0].n).toBe(before + 2)
})

it('signed out: the 21st search from one address within the hour is 429, another address is fine', async () => {
  const ip = newIp()
  for (let i = 0; i < 20; i++) expect((await search('refund', { lang: 'en', ip })).status).toBe(200)
  const over = await search('refund', { lang: 'en', ip })
  expect(over.status).toBe(429)
  expect(over.body).toMatchObject({ error: 'RATE_LIMITED' })
  expect((await search('refund', { lang: 'en' })).status).toBe(200)
  // the address is stored only as a salted hash
  const rows = (await pool.query("SELECT client_key FROM translation_requests WHERE client_key LIKE 'help-search:ip:%'")).rows.map((r) => r.client_key as string)
  expect(rows.some((k) => k === `help-search:ip:${ipHashOf(new Headers({ 'x-vercel-forwarded-for': ip }))}`)).toBe(true)
  expect(rows.some((k) => k.includes(ip))).toBe(false)
})

it('signed in: 60 per hour per account, counted apart from other accounts', async () => {
  await seedUser('hs-a')
  await seedUser('hs-b')
  await pool.query("INSERT INTO translation_requests (client_key) SELECT 'help-search:user:hs-a' FROM generate_series(1, 60)")
  const limited = await search('refund', { lang: 'en', uid: 'hs-a' })
  expect(limited.status).toBe(429)
  expect((await search('refund', { lang: 'en', uid: 'hs-b' })).status).toBe(200)
  expect((await pool.query("SELECT count(*)::int AS n FROM translation_requests WHERE client_key = 'help-search:user:hs-a'")).rows[0].n).toBe(60) // the refused one is not counted
})

it('the search text is not stored anywhere in the counter rows', async () => {
  await search('Zahnarzt-Termin-Geheimtext', { lang: 'de' })
  const { rows } = await pool.query("SELECT * FROM translation_requests WHERE client_key LIKE 'help-search:%'")
  expect(JSON.stringify(rows)).not.toContain('Geheimtext')
})
