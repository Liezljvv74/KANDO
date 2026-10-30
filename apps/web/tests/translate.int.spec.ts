import { createHash } from 'node:crypto'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appPool, db, pool } from '@kando/db'
import type { ProviderDetail } from '@kando/contract'
import {
  clientKeyOf,
  needsTranslation,
  textsOf,
  TRANSLATE_GLOBAL_LIMIT_PER_DAY,
  TRANSLATE_LIMIT_PER_HOUR,
  TRANSLATE_TIMEOUT_MS,
  TranslationUnavailable,
  translateTexts,
  type TranslatableTexts,
} from '@kando/domain'
import { cleanupUsers, seedBase, seedProvider } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
process.env.NEON_AUTH_COOKIE_SECRET ||= 'test-secret-not-real'
const translationRoute = await import('../app/app-api/v1/providers/[slug]/translation/route')
const stamp = Date.now()
const clients: string[] = []
const sources: string[] = []
const keyOf = (s: string) => createHash('sha256').update(s).digest('hex')

const client = (name: string) => {
  const k = `tr-${name}-${stamp}`
  if (!clients.includes(k)) clients.push(k)
  return k
}
// Unique English / German sentences per test, so the shared store never serves another test's text.
const en = (s: string) => {
  const t = `The carpenter builds kitchens and wardrobes for families in the region (${s} ${stamp}).`
  sources.push(t)
  return t
}
const de = (s: string) => `Der Schreiner baut Küchen und Schränke für Familien in der Region (${s} ${stamp}).`

const texts = (over: Partial<TranslatableTexts> = {}): TranslatableTexts => ({
  bio: null,
  strengths: null,
  experience: null,
  skills: [],
  services: [],
  references: [],
  ...over,
})

// The owner connection, as the route's after-transaction answer uses it.
const translate = (t: TranslatableTexts, lang: 'de' | 'en', key: string) => translateTexts(db, t, lang, key)

// Fake OpenRouter: records each request and answers with whatever `map` makes of the sent texts.
let calls: { url: string; init: RequestInit; body: { temperature: number; response_format: unknown; max_tokens: number; messages: { content: string }[] } }[]
const answer = (map: (sent: Record<string, string>) => unknown) =>
  vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
    const body = JSON.parse(String(init?.body))
    calls.push({ url: String(url), init: init!, body })
    const content = map(JSON.parse(body.messages.at(-1)!.content))
    return new Response(JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] }))
  })
const echo = (prefix: string) => (sent: Record<string, string>) => Object.fromEntries(Object.entries(sent).map(([k, v]) => [k, prefix + v]))
const sentKeys = (i = 0) => JSON.parse(calls[i]!.body.messages.at(-1)!.content)
const counted = async (k: string) => (await pool.query('SELECT count(*)::int AS n FROM translation_requests WHERE client_key = $1', [k])).rows[0].n as number

beforeEach(() => {
  calls = []
  process.env.OPENROUTER_API_KEY = 'test-key-not-real'
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  delete process.env.TRANSLATE_TIMEOUT_MS
})
afterAll(async () => {
  delete process.env.OPENROUTER_API_KEY
  await pool.query('DELETE FROM translation_requests WHERE client_key = ANY($1)', [clients])
  await pool.query('DELETE FROM translations WHERE key = ANY($1)', [sources.map(keyOf)])
})

describe('translate', () => {
  it('stores translations and serves the second request from the store without a call', async () => {
    const t = texts({ bio: en('store') })
    const f = answer(echo('DE: '))
    const first = await translate(t, 'de', client('store'))
    const second = await translate(t, 'de', client('store'))
    expect(first.bio).toBe(`DE: ${t.bio}`)
    expect(second).toEqual(first)
    expect(f).toHaveBeenCalledTimes(1)
    const [c] = calls
    expect(c!.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((c!.init.headers as Record<string, string>).Authorization).toBe('Bearer test-key-not-real')
    expect(c!.body.temperature).toBe(0)
    expect(c!.body.response_format).toEqual({ type: 'json_object' })
    expect(Object.keys(c!.body).sort()).toEqual(['max_tokens', 'messages', 'model', 'response_format', 'temperature'])
    // Only the page texts (by stable id) go to the model, nothing else.
    expect(sentKeys()).toEqual({ bio: t.bio })
  })

  it('an edited text is re-translated, the rest comes from the store', async () => {
    const [a, b, c] = [en('edit-a'), en('edit-b'), en('edit-c')]
    answer(echo('DE: '))
    await translate(texts({ bio: a, strengths: b }), 'de', client('edit'))
    calls.length = 0
    const out = await translate(texts({ bio: a, strengths: c }), 'de', client('edit'))
    expect(calls).toHaveLength(1)
    expect(sentKeys()).toEqual({ strengths: c })
    expect(out.bio).toBe(`DE: ${a}`)
    expect(out.strengths).toBe(`DE: ${c}`)
  })

  it('texts already in the target language are returned unchanged without a call', async () => {
    const t = texts({ bio: de('own1'), skills: [de('own2')] })
    const f = answer(echo('X: '))
    expect(await translate(t, 'de', client('own'))).toEqual(t)
    expect(f).not.toHaveBeenCalled()
  })

  it('a malformed or incomplete model answer stores nothing and throws TranslationUnavailable', async () => {
    const t = texts({ bio: en('bad-a'), strengths: en('bad-b') })
    for (const bad of [{ bio: 'Nur eins' }, 'this is not json', { bio: 'x', strengths: 5 }, { bio: 'x', strengths: '  ' }, { bio: '', strengths: 'y' }]) {
      answer(() => bad)
      await expect(translate(t, 'de', client('bad'))).rejects.toBeInstanceOf(TranslationUnavailable)
      vi.restoreAllMocks()
    }
    // Nothing was stored: a good answer is asked for both texts again.
    calls.length = 0
    answer(echo('DE: '))
    await translate(t, 'de', client('bad'))
    expect(calls).toHaveLength(1)
    expect(Object.keys(sentKeys()).sort()).toEqual(['bio', 'strengths'])
  })

  it('a non-2xx answer throws TranslationUnavailable', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }))
    await expect(translate(texts({ bio: en('500') }), 'de', client('500'))).rejects.toBeInstanceOf(TranslationUnavailable)
  })

  it('line breaks survive', async () => {
    const t = texts({ bio: `${en('lines')}\n\n- first item\n- second item` })
    answer(echo('DE: '))
    const out = await translate(t, 'de', client('lines'))
    expect(sentKeys().bio).toContain('\n\n- first item\n- second item')
    expect(out.bio).toBe(`DE: ${t.bio}`)
  })

  it('no key -> TranslationUnavailable without a call', async () => {
    delete process.env.OPENROUTER_API_KEY
    const f = answer(echo('DE: '))
    await expect(translate(texts({ bio: en('nokey') }), 'de', client('nokey'))).rejects.toBeInstanceOf(TranslationUnavailable)
    expect(f).not.toHaveBeenCalled()
  })

  it('the 31st AI call within an hour for one client key -> TranslationUnavailable', async () => {
    const k = client('limit')
    for (let i = 0; i < TRANSLATE_LIMIT_PER_HOUR; i++) await pool.query('INSERT INTO translation_requests (client_key) VALUES ($1)', [k])
    const f = answer(echo('DE: '))
    await expect(translate(texts({ bio: en('limit') }), 'de', k)).rejects.toBeInstanceOf(TranslationUnavailable)
    expect(f).not.toHaveBeenCalled()
    // Another client is unaffected, and its call is counted.
    const other = client('limit-other')
    await translate(texts({ bio: en('limit') }), 'de', other)
    expect(await counted(other)).toBe(1)
  })

  it('the global daily cap refuses every caller, and only counts the last 24 hours', async () => {
    const total = async () => (await pool.query("SELECT count(*)::int AS n FROM translation_requests WHERE created_at > now() - interval '24 hours'")).rows[0].n as number
    vi.stubEnv('TRANSLATE_GLOBAL_LIMIT_PER_DAY', String((await total()) + 1))
    const f = answer(echo('DE: '))
    await translate(texts({ bio: en('global-0') }), 'de', client('global-a')) // the last call under the cap
    f.mockClear()
    await expect(translate(texts({ bio: en('global-1') }), 'de', client('global-b'))).rejects.toBeInstanceOf(TranslationUnavailable)
    expect(f).not.toHaveBeenCalled()
    expect(await counted(client('global-b'))).toBe(0)
    expect(TRANSLATE_GLOBAL_LIMIT_PER_DAY).toBe(2000)
  })

  it('the limit boundary: the 30th call passes, the 31st is refused', async () => {
    expect(TRANSLATE_LIMIT_PER_HOUR).toBe(30)
    const k = client('boundary')
    for (let i = 0; i < 29; i++) await pool.query('INSERT INTO translation_requests (client_key) VALUES ($1)', [k])
    answer(echo('DE: '))
    await translate(texts({ bio: en('boundary-0') }), 'de', k)
    await expect(translate(texts({ bio: en('boundary-1') }), 'de', k)).rejects.toBeInstanceOf(TranslationUnavailable)
    expect(await counted(k)).toBe(30)
  })

  it('a timeout -> TranslationUnavailable', async () => {
    process.env.TRANSLATE_TIMEOUT_MS = '50'
    vi.spyOn(global, 'fetch').mockImplementation(
      (_u, init) => new Promise((_res, rej) => init!.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))),
    )
    await expect(translate(texts({ bio: en('timeout') }), 'de', client('timeout'))).rejects.toBeInstanceOf(TranslationUnavailable)
  })

  it('concurrent translations of the same page store one row per text', async () => {
    const t = texts({ bio: en('conc-a'), strengths: en('conc-b') })
    answer(echo('DE: '))
    const [a, b] = await Promise.all([translate(t, 'de', client('conc')), translate(t, 'de', client('conc'))])
    expect(a.bio).toBe(`DE: ${t.bio}`)
    expect(b.strengths).toBe(`DE: ${t.strengths}`)
    for (const s of [t.bio!, t.strengths!]) {
      const rows = (await pool.query("SELECT 1 FROM translations WHERE key = $1 AND lang = 'de'", [keyOf(s)])).rows
      expect(rows).toHaveLength(1)
    }
  })

  it('writes through the request transaction and commits with it', async () => {
    const t = texts({ bio: en('req') })
    answer(echo('DE: '))
    await translate(t, 'de', client('req'))
    expect((await pool.query('SELECT 1 FROM translations WHERE key = $1', [keyOf(t.bio!)])).rows).toHaveLength(1)
  })

  it('the default timeout is 12 seconds', () => {
    expect(TRANSLATE_TIMEOUT_MS).toBe(12_000)
  })

  it('French and Afrikaans texts are flagged and sent to the model, in either viewer language', async () => {
    const fr = `Le menuisier construit des cuisines et des armoires pour les familles de la région (${stamp}).`
    const af = `Die skrynwerker bou kombuise en kaste vir gesinne in die streek (${stamp}).`
    sources.push(fr, af)
    for (const lang of ['de', 'en'] as const) {
      expect(needsTranslation(texts({ bio: fr, strengths: af }), lang)).toBe(true)
    }
    answer(echo('DE: '))
    const out = await translate(texts({ bio: fr, strengths: af }), 'de', client('foreign'))
    expect(sentKeys()).toEqual({ bio: fr, strengths: af })
    expect(out.bio).toBe(`DE: ${fr}`)
  })

  it('a page the detector cannot classify is translated when long enough, left alone when short', async () => {
    const unknown = `12345 67890 12345 67890 12345 ${stamp}`
    sources.push(unknown, '12345 6789')
    expect(needsTranslation(texts({ bio: unknown }), 'de')).toBe(true)
    expect(needsTranslation(texts({ bio: '12345 6789' }), 'de')).toBe(false)
    // Short texts of a page that needs translation are sent too (the model returns them unchanged).
    answer(echo('DE: '))
    await translate(texts({ bio: unknown, strengths: '12345 6789' }), 'de', client('unknown'))
    expect(sentKeys()).toEqual({ bio: unknown, strengths: '12345 6789' })
  })

  it('a German profile of short skills and titles needs no translation for de but does for en', async () => {
    const profile = texts({
      bio: `Ich baue Möbel nach Maß und montiere Küchen. Zuverlässig und pünktlich seit zwölf Jahren (${stamp}).`,
      skills: ['Hochzeiten', 'Umzug', 'Möbelmontage', 'Fingerfood', 'SEO'],
      services: [
        { id: 'a', title: 'Online oder vor Ort.', description: null },
        { id: 'b', title: 'Umzug', description: null },
      ],
    })
    expect(needsTranslation(profile, 'de')).toBe(false)
    expect(needsTranslation(profile, 'en')).toBe(true)
    const f = answer(echo('X: '))
    expect(await translate(profile, 'de', client('shortde'))).toEqual(profile)
    expect(f).not.toHaveBeenCalled()
  })

  it('a Markdown-fenced answer parses; the request carries max_tokens', async () => {
    const t = texts({ bio: en('fence') })
    answer((sent) => '```json\n' + JSON.stringify(echo('DE: ')(sent)) + '\n```')
    const out = await translate(t, 'de', client('fence'))
    expect(out.bio).toBe(`DE: ${t.bio}`)
    expect(calls[0]!.body.max_tokens).toBeGreaterThan(0)
    expect(calls[0]!.body.max_tokens).toBeLessThanOrEqual(4000)
  })

  it('an empty string from the model stores nothing', async () => {
    const t = texts({ bio: en('empty') })
    answer(() => ({ bio: '' }))
    await expect(translate(t, 'de', client('empty'))).rejects.toBeInstanceOf(TranslationUnavailable)
    expect((await pool.query('SELECT 1 FROM translations WHERE key = $1', [keyOf(t.bio!)])).rows).toHaveLength(0)
  })

  it('counter rows older than 24 hours are deleted; recent ones stay', async () => {
    const k = client('old')
    await pool.query("INSERT INTO translation_requests (client_key, created_at) VALUES ($1, now() - interval '25 hours')", [k])
    answer(echo('DE: '))
    await translate(texts({ bio: en('old') }), 'de', k)
    expect(await counted(k)).toBe(1)
  })

  it('anonymous client keys are salted hashes, never the raw IP', () => {
    const req = (ip: string | null) => new Headers(ip ? { 'x-vercel-forwarded-for': ip } : {})
    const k = clientKeyOf(null, req('203.0.113.7, 10.0.0.1'))
    expect(k).toMatch(/^ip:[0-9a-f]{32}$/)
    expect(k).not.toContain('203.0.113.7')
    expect(clientKeyOf(null, req('203.0.113.7'))).toBe(k)
    expect(clientKeyOf(null, req(null))).toBe(clientKeyOf(null, req('')))
    // A forged x-forwarded-for neither changes the key nor lets a caller pick another bucket; x-real-ip is the fallback.
    const spoofed = new Headers({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-forwarded-for': '6.6.6.6' })
    expect(clientKeyOf(null, spoofed)).toBe(k)
    expect(clientKeyOf(null, new Headers({ 'x-forwarded-for': '6.6.6.6' }))).toBe(clientKeyOf(null, req(null)))
    expect(clientKeyOf(null, new Headers({ 'x-real-ip': '203.0.113.7' }))).toBe(k)
    expect(clientKeyOf({ id: 'u-5' } as never, req('1.1.1.1'))).toBe('user:u-5')
  })

  it('textsOf picks the translatable fields of a profile', () => {
    const p = {
      bio: 'b',
      strengths: null,
      experience: 'e',
      skills: ['s1', 's2'],
      services: [{ id: 'x12', category: 'x', title: 'T', description: null, priceType: 'hourly', price: 1 }],
      references: [{ id: 'r3', clientName: 'C', description: 'D', year: 2020 }],
    } as unknown as ProviderDetail
    expect(textsOf(p)).toEqual({
      bio: 'b',
      strengths: null,
      experience: 'e',
      skills: ['s1', 's2'],
      services: [{ id: 'x12', title: 'T', description: null }],
      references: [{ id: 'r3', description: 'D' }],
    })
  })

  it('needsTranslation is false for a page entirely in the viewer language and true for a mixed page', () => {
    const german = texts({ bio: de('n1'), skills: [de('n2')] })
    expect(needsTranslation(german, 'de')).toBe(false)
    expect(needsTranslation(german, 'en')).toBe(true)
    expect(needsTranslation({ ...german, strengths: 'The carpenter builds kitchens and wardrobes for families in the whole region and also repairs doors.' }, 'de')).toBe(true)
  })
})

it('the model call runs with no request transaction open; a failed call still counts', async () => {
  const { categoryId } = await seedBase()
  const uid = `ptr-open-${stamp}`
  try {
    await seedProvider(uid, { name: `Tischlerei open ${stamp}`, categoryId })
    await pool.query('UPDATE providers SET bio = $1 WHERE owner_id = $2', [en('open'), uid])
    const ip = `10.6.${stamp % 255}.${stamp % 191}`
    const key = clientKeyOf(null, new Headers({ 'x-vercel-forwarded-for': ip }))
    clients.push(key)
    let open = -1
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      open = appPool.totalCount - appPool.idleCount
      return new Response('{}', { status: 500 })
    })
    const res = await translationRoute.GET(new Request('http://localhost/app-api/v1/providers/x?lang=de', { headers: { 'x-vercel-forwarded-for': ip } }), {
      params: Promise.resolve({ slug: `${uid}-slug` }),
    })
    expect(res.status).toBe(503)
    expect(open).toBe(0)
    expect(await counted(key)).toBe(1)
  } finally {
    await cleanupUsers()
  }
})
