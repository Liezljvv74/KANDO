import { createHash } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { clientKeyOf } from '@kando/domain'
import { setStorageForTests } from '@kando/domain/src/testing'
import { cleanupUsers, EMAIL, memoryStorage, seedBase, seedProvider } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
process.env.NEON_AUTH_COOKIE_SECRET ||= 'test-secret-not-real'
const providerRoute = await import('../app/app-api/v1/providers/[slug]/route')
const translationRoute = await import('../app/app-api/v1/providers/[slug]/translation/route')

const stamp = Date.now()
// One unique English text per provider, so the shared store never serves another test's text.
const bioOf = (key: string) => `The carpenter builds kitchens and wardrobes for families in the region (${key} ${stamp}).`
const keyOf = (s: string) => createHash('sha256').update(s).digest('hex')
const ipKeyOf = (ip: string) => clientKeyOf(null, new Headers({ 'x-vercel-forwarded-for': ip }))
const ip = `10.9.${stamp % 255}.${stamp % 199}`
const ipKey = ipKeyOf(ip)
const clients = [ipKey]
const sources: string[] = []
const slugs: Record<string, string> = {}
let categoryId: string

let calls: { messages: { content: string }[] }[]
const fakeModel = (status = 200) =>
  vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    calls.push(body)
    if (status !== 200) return new Response('{}', { status })
    const sent = JSON.parse(body.messages.at(-1)!.content)
    const content = JSON.stringify(Object.fromEntries(Object.entries(sent).map(([k, v]) => [k, `DE: ${v}`])))
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }))
  })

const get = async (route: { GET: typeof providerRoute.GET }, slug: string, query = '', init: RequestInit = {}) => {
  const res = await route.GET(new Request(`http://localhost/app-api/v1/providers/${slug}${query}`, init), { params: Promise.resolve({ slug }) })
  return { status: res.status, body: await res.json() }
}
const translate = (slug: string, query = '?lang=de', init: RequestInit = {}) => get(translationRoute, slug, query, init)
const count = async (table: 'translation_requests' | 'translations', col: 'client_key' | 'key', value: string) =>
  (await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${col} = $1`, [value])).rows[0].n as number

async function provider(key: string, o: { status?: string; suspended?: boolean; bio?: string } = {}) {
  const uid = `ptr-${key}`
  const bio = o.bio ?? bioOf(key)
  sources.push(bio)
  clients.push(`user:${uid}`)
  await seedProvider(uid, { name: `Tischlerei ${key} ${stamp}`, categoryId, status: o.status, suspended: o.suspended })
  await pool.query('UPDATE providers SET bio = $1 WHERE owner_id = $2', [bio, uid])
  await pool.query("UPDATE services SET title = 'Möbelbau' WHERE provider_id = (SELECT id FROM providers WHERE owner_id = $1)", [uid])
  slugs[key] = `${uid}-slug`
  return { slug: slugs[key]!, bio, uid }
}

beforeAll(async () => {
  setStorageForTests(memoryStorage())
  ;({ categoryId } = await seedBase())
  await provider('ok')
  await provider('draft', { status: 'draft' })
  await provider('suspended', { suspended: true })
})
beforeEach(() => {
  calls = []
  process.env.OPENROUTER_API_KEY = 'test-key-not-real'
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => {
  setStorageForTests(undefined)
  delete process.env.OPENROUTER_API_KEY
  await pool.query('DELETE FROM translation_requests WHERE client_key = ANY($1)', [clients])
  await pool.query('DELETE FROM translations WHERE key = ANY($1)', [sources.map(keyOf)])
  await cleanupUsers()
})

it('returns translated texts in the page shape', async () => {
  const f = fakeModel()
  const { status, body } = await translate(slugs.ok!, '?lang=de', { headers: { 'x-vercel-forwarded-for': `${ip}, 1.1.1.1` } })
  expect(status).toBe(200)
  expect(Object.keys(body).sort()).toEqual(['bio', 'experience', 'references', 'services', 'skills', 'strengths'])
  expect(body.bio).toBe(`DE: ${bioOf('ok')}`)
  expect(body.services[0].title).toBe('DE: Möbelbau') // short texts of a page that needs translation are sent too
  expect(f).toHaveBeenCalledTimes(1)
  expect(await count('translation_requests', 'client_key', ipKey)).toBe(1) // the Vercel address header is the key, stored hashed
  expect(ipKey).not.toContain(ip)
})

it('a draft or suspended provider -> 404, no call', async () => {
  const f = fakeModel()
  for (const key of ['draft', 'suspended']) expect((await translate(slugs[key]!)).status).toBe(404)
  expect((await translate(`nobody-${stamp}`)).status).toBe(404)
  expect(f).not.toHaveBeenCalled()
})

it('unknown lang -> 400', async () => {
  const f = fakeModel()
  for (const q of ['', '?lang=fr', '?lang=']) expect((await translate(slugs.ok!, q)).status).toBe(400)
  expect(f).not.toHaveBeenCalled()
})

it('service failure -> 503 and nothing stored', async () => {
  const p = await provider('fail')
  const failIp = `10.8.${stamp % 255}.${stamp % 197}`
  const failKey = ipKeyOf(failIp)
  clients.push(failKey)
  fakeModel(500)
  const r = await translate(p.slug, '?lang=de', { headers: { 'x-vercel-forwarded-for': failIp } })
  expect(r.status).toBe(503)
  expect(r.body).toEqual({ error: 'Translation unavailable' })
  expect(await count('translations', 'key', keyOf(p.bio))).toBe(0)
  // The 503 is returned, not thrown: the transaction commits and the rate-limit counter stays.
  expect(await count('translation_requests', 'client_key', failKey)).toBe(1)
})

it('a logged-in caller is counted under the user id', async () => {
  const p = await provider('authed')
  fakeModel()
  const cookie = `uid=${p.uid}:${EMAIL(p.uid)}`
  expect((await translate(p.slug, '?lang=de', { headers: { cookie } })).status).toBe(200)
  expect(await count('translation_requests', 'client_key', `user:${p.uid}`)).toBe(1)
})

it('the provider endpoint reports translatable per viewer language', async () => {
  const p = await provider('flag', { bio: `Der Schreiner baut Küchen und Schränke für Familien in der Region (flag ${stamp}).` })
  expect((await get(providerRoute, p.slug, '?lang=en')).body.translatable).toBe(true) // German texts, English viewer
  // English bio: a German viewer (and a missing lang, which means de) can translate it.
  for (const q of ['?lang=de', '']) expect((await get(providerRoute, slugs.ok!, q)).body.translatable).toBe(true)
  expect((await get(providerRoute, slugs.ok!, '?lang=de')).body.slug).toBe(slugs.ok)
  // German page with a short German title: no button for a German viewer.
  await pool.query("UPDATE services SET title = 'Umzug' WHERE provider_id = (SELECT id FROM providers WHERE owner_id = $1)", [p.uid])
  expect((await get(providerRoute, p.slug, '?lang=de')).body.translatable).toBe(false)
})

it('accepts no text from the client', async () => {
  const p = await provider('inject')
  fakeModel()
  const r = await translate(p.slug, '?lang=de&bio=INJECTED&text=INJECTED', {
    headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': ip },
  })
  expect(r.status).toBe(200)
  expect(calls).toHaveLength(1)
  expect(JSON.stringify(calls[0])).not.toContain('INJECTED')
  const sent = JSON.parse(calls[0]!.messages.at(-1)!.content)
  expect(sent.bio).toBe(p.bio)
  expect(sent).not.toHaveProperty('displayName')
})

const total = async () => (await pool.query('SELECT count(*)::int AS n FROM translation_requests')).rows[0].n as number

it('fails closed without a usable secret: 503, no counter row, no model call', async () => {
  const p = await provider('nosecret')
  const f = fakeModel()
  const keep = process.env.NEON_AUTH_COOKIE_SECRET
  const before = await total()
  const noSecretIp = `10.7.${stamp % 255}.${stamp % 193}`
  try {
    for (const secret of [undefined, 'short-secret']) {
      if (secret === undefined) delete process.env.NEON_AUTH_COOKIE_SECRET
      else process.env.NEON_AUTH_COOKIE_SECRET = secret
      const r = await translate(p.slug, '?lang=de', { headers: { 'x-vercel-forwarded-for': noSecretIp } })
      expect(r.status).toBe(503)
      expect(r.body).toEqual({ error: 'Translation unavailable' })
    }
  } finally {
    process.env.NEON_AUTH_COOKIE_SECRET = keep
  }
  expect(f).not.toHaveBeenCalled()
  expect(await total()).toBe(before)
})
