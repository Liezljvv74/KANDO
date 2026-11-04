import sharp from 'sharp'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { IdScanModelSchema } from '@kando/contract'
import { AiUnavailable, cleanScan, ID_SCAN_PROMPT, SCANS_PER_HOUR, type IdScanner } from '@kando/domain'
import { openRouterIdScanner } from '@kando/domain/src/ai/id-scan'
import { setIdScannerForTests, setStorageForTests } from '@kando/domain/src/testing'
import { cleanupUsers, EMAIL, memoryStorage, seedBase, seedUser, sized } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const route = await import('../app/app-api/v1/me/id-scan/route')
const meRoute = await import('../app/app-api/v1/me/route')
const exportRoute = await import('../app/app-api/v1/me/export/route')
const { call } = await import('./helpers')

const GOOD = { readable: true, firstName: 'Anna Maria', lastName: 'Beispiel', birthDate: '1990-05-17', street: 'Musterweg 1', postcode: '14641', city: 'Wustermark' }
let calls = 0
let reply: () => Promise<{ result: unknown; costUsd: number | null; tokens: number | null }>
const fake: IdScanner = {
  model: 'fake',
  scan: async () => {
    calls++
    return (await reply()) as never
  },
}

const photo = async () => sharp({ create: { width: 40, height: 30, channels: 3, background: '#888' } }).jpeg().toBuffer()
async function scan(as: string, bytes?: Buffer) {
  const form = new FormData()
  form.set('file', new File([new Uint8Array(bytes ?? (await photo()))], 'id.jpg', { type: 'image/jpeg' }))
  return route.POST(await sized(new Request('http://localhost/app-api/v1/me/id-scan', { method: 'POST', headers: { origin: 'http://localhost', cookie: `uid=${as}:${EMAIL(as)}` }, body: form })), { params: Promise.resolve({}) })
}
const rows = async (id: string) => (await pool.query("SELECT cost_eur::float AS c, document_id, failure FROM document_ai_checks WHERE owner_id = $1 AND failure = 'id-scan'", [id])).rows

beforeAll(async () => {
  setStorageForTests(memoryStorage())
  await seedBase()
  await seedUser('sc1')
  await seedUser('sc2')
  await pool.query('UPDATE users SET terms_accepted_at = NULL WHERE id = $1', ['sc2'])
})
beforeEach(() => {
  calls = 0
  reply = async () => ({ result: GOOD, costUsd: 0.004, tokens: 500 })
  setIdScannerForTests(fake)
})
afterEach(async () => {
  setIdScannerForTests(undefined)
  await pool.query("DELETE FROM document_ai_checks WHERE failure = 'id-scan'")
})
afterAll(async () => {
  setStorageForTests(undefined)
  await cleanupUsers()
})

describe('POST /me/id-scan', () => {
  it('returns suggestions and saves nothing', async () => {
    const before = (await pool.query('SELECT first_name, last_name, birth_date, address_postcode FROM users WHERE id = $1', ['sc1'])).rows[0]
    const res = await scan('sc1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(GOOD)
    expect((await pool.query('SELECT first_name, last_name, birth_date, address_postcode FROM users WHERE id = $1', ['sc1'])).rows[0]).toEqual(before)
    expect(calls).toBe(1)
  })

  it('books the cost as a row without a document', async () => {
    await scan('sc1')
    const r = await rows('sc1')
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ c: 0.004, document_id: null })
  })

  it('needs a signed-in person (401) and accepted terms (403 TERMS_NOT_ACCEPTED, nothing sent)', async () => {
    const anon = await route.POST(await sized(new Request('http://localhost/app-api/v1/me/id-scan', { method: 'POST', headers: { origin: 'http://localhost' }, body: new FormData() })), { params: Promise.resolve({}) })
    expect(anon.status).toBe(401)
    const res = await scan('sc2')
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('TERMS_NOT_ACCEPTED')
    expect(calls).toBe(0)
  })

  it('is 503 ID_SCAN_UNAVAILABLE while the AI is off', async () => {
    setIdScannerForTests(undefined)
    const keys = ['OPENROUTER_API_KEY', 'AI_DOCUMENT_MODEL'] as const
    const saved = keys.map((k) => process.env[k])
    keys.forEach((k) => delete process.env[k])
    try {
      const res = await scan('sc1')
      expect(res.status).toBe(503)
      expect((await res.json()).error).toBe('ID_SCAN_UNAVAILABLE')
    } finally {
      keys.forEach((k, i) => saved[i] === undefined || (process.env[k] = saved[i]))
    }
  })

  it('refuses a file that is not an image (400) before any model call', async () => {
    const res = await scan('sc1', Buffer.from('not an image'))
    expect(res.status).toBe(400)
    expect(calls).toBe(0)
  })

  it('document checks do not use up the scans (separate hourly limits)', async () => {
    for (let i = 0; i < 10; i++) await pool.query("INSERT INTO document_ai_checks (owner_id, model, decision, finished_at) VALUES ('sc1', 'm', 'sent-to-staff', now())")
    try {
      expect((await scan('sc1')).status).toBe(200)
    } finally {
      await pool.query("DELETE FROM document_ai_checks WHERE owner_id = 'sc1' AND failure IS NULL")
    }
  })

  it('parallel calls cannot all pass the limit: at most the limit reaches the model', async () => {
    const res = await Promise.all(Array.from({ length: SCANS_PER_HOUR + 5 }, () => scan('sc1')))
    expect(res.filter((r) => r.status === 200).length).toBeLessThanOrEqual(SCANS_PER_HOUR)
    expect(calls).toBeLessThanOrEqual(SCANS_PER_HOUR)
  })

  it('stops at the hourly limit (429) without a model call', async () => {
    for (let i = 0; i < SCANS_PER_HOUR; i++) expect((await scan('sc1')).status).toBe(200)
    const res = await scan('sc1')
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('ID_SCAN_RATE_LIMIT')
    expect(calls).toBe(SCANS_PER_HOUR)
  })

  it('stops when the monthly cap is spent (503, nothing sent)', async () => {
    const old = process.env.AI_MONTHLY_CAP_EUR
    process.env.AI_MONTHLY_CAP_EUR = '0.01'
    try {
      await pool.query("INSERT INTO document_ai_checks (owner_id, model, failure, decision, cost_eur) VALUES ('sc2', 'm', 'id-scan', 'sent-to-staff', 0.5)")
      const res = await scan('sc1')
      expect(res.status).toBe(503)
      expect(calls).toBe(0)
    } finally {
      if (old === undefined) delete process.env.AI_MONTHLY_CAP_EUR
      else process.env.AI_MONTHLY_CAP_EUR = old
    }
  })

  it('answers 502 ID_SCAN_FAILED when the model fails, and the cost it reported still counts', async () => {
    reply = async () => {
      throw new AiUnavailable('error', 'AI answer had the wrong shape', 0.003)
    }
    const res = await scan('sc1')
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('ID_SCAN_FAILED')
    expect((await rows('sc1'))[0]!.c).toBe(0.003)
  })

  it('a timeout counts the fallback cost; a refusal costs nothing', async () => {
    reply = async () => {
      throw new AiUnavailable('timeout', 'AI service timed out')
    }
    await scan('sc1')
    expect((await rows('sc1'))[0]!.c).toBe(0.02)
    await pool.query("DELETE FROM document_ai_checks WHERE failure = 'id-scan'")
    reply = async () => {
      throw new AiUnavailable('error', 'AI service answered 402')
    }
    await scan('sc1')
    expect((await rows('sc1'))[0]!.c).toBe(0)
  })
})

describe('cleanScan', () => {
  it('cuts a value that is too long instead of failing the whole scan', () => {
    const parsed = IdScanModelSchema.parse({ ...GOOD, firstName: 'A'.repeat(200), street: 'B'.repeat(500) })
    expect(parsed.firstName).toHaveLength(60)
    expect(parsed.street).toHaveLength(120)
    expect(parsed.lastName).toBe('Beispiel')
  })
  it('gives nothing for an unreadable photo', () => {
    expect(cleanScan({ ...GOOD, readable: false })).toEqual({ readable: false, firstName: null, lastName: null, birthDate: null, street: null, postcode: null, city: null })
  })
  it('drops a date that is not a real past day, and names or cities with digits', () => {
    expect(cleanScan({ ...GOOD, birthDate: '2999-01-01' }).birthDate).toBeNull()
    expect(cleanScan({ ...GOOD, birthDate: '1990-02-31' }).birthDate).toBeNull()
    expect(cleanScan({ ...GOOD, birthDate: '17.05.1990' }).birthDate).toBeNull()
    expect(cleanScan({ ...GOOD, lastName: 'C01234567' }).lastName).toBeNull()
    expect(cleanScan({ ...GOOD, city: '12345' }).city).toBeNull()
    expect(cleanScan(GOOD)).toEqual(GOOD)
  })
  it('drops a street without letters and a postcode that is a city name', () => {
    expect(cleanScan({ ...GOOD, street: '1234 5678' }).street).toBeNull()
    expect(cleanScan({ ...GOOD, postcode: 'Berlin', city: null }).postcode).toBeNull()
    expect(cleanScan({ ...GOOD, postcode: 'SW1A 1AA' }).postcode).toBe('SW1A 1AA')
  })
  it('puts postcode and city in their own fields, German style', () => {
    const at = (postcode: string | null, city: string | null) => { const r = cleanScan({ ...GOOD, postcode, city }); return [r.postcode, r.city] }
    expect(at('14641', 'Wustermark')).toEqual(['14641', 'Wustermark'])
    expect(at('D-14641', 'Wustermark')).toEqual(['14641', 'Wustermark'])
    expect(at('14641 Wustermark', null)).toEqual(['14641', 'Wustermark'])
    expect(at(null, '14641 Wustermark')).toEqual(['14641', 'Wustermark'])
    expect(at('Wustermark', '14641')).toEqual(['14641', 'Wustermark'])
  })
  it('does not accept today as a date of birth', () => {
    expect(cleanScan({ ...GOOD, birthDate: new Date().toISOString().slice(0, 10) }).birthDate).toBeNull()
  })
})

describe('the model call', () => {
  const okAnswer = (content: unknown) => vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify(content) } }], usage: { cost: 0.004, total_tokens: 400 } }))

  it('sends the same privacy settings as the document check, one pinned provider, and the ID prompt', async () => {
    const f = okAnswer(GOOD)
    const out = await openRouterIdScanner({ apiKey: 'k', model: 'm', provider: 'google-vertex', fetchImpl: f as unknown as typeof fetch }).scan({ bytes: await photo(), mime: 'image/jpeg' })
    expect(out.result.birthDate).toBe('1990-05-17')
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, { body: string }])[1].body)
    expect(body.provider).toEqual({ data_collection: 'deny', zdr: true, allow_fallbacks: false, only: ['google-vertex'] })
    expect(body.messages[0].content).toBe(ID_SCAN_PROMPT)
    expect(ID_SCAN_PROMPT).toMatch(/never write the document number/i)
  })

  it('treats an answer of the wrong shape as a failure that carries its cost', async () => {
    const f = okAnswer({ nope: true })
    await expect(openRouterIdScanner({ apiKey: 'k', model: 'm', fetchImpl: f as unknown as typeof fetch }).scan({ bytes: await photo(), mime: 'image/jpeg' })).rejects.toMatchObject({ costUsd: 0.004 })
  })
})

describe('the date of birth in /me', () => {
  it('is saved on request, shown, exported, and refused when it is not a real past day', async () => {
    expect((await call(meRoute.PATCH, 'sc1', 'PATCH', { birthDate: '1990-05-17' })).status).toBe(200)
    expect((await (await call(meRoute.GET, 'sc1')).json()).birthDate).toBe('1990-05-17')
    expect((await (await call(exportRoute.GET, 'sc1')).json()).user.birthDate).toBe('1990-05-17')
    for (const bad of ['2999-01-01', '1990-13-40', '1800-01-01', '17.05.1990']) expect((await call(meRoute.PATCH, 'sc1', 'PATCH', { birthDate: bad })).status).toBe(400)
    expect((await call(meRoute.PATCH, 'sc1', 'PATCH', { birthDate: null })).status).toBe(200)
    expect((await (await call(meRoute.GET, 'sc1')).json()).birthDate).toBeNull()
  })
})
