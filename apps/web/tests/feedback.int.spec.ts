import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db, pool } from '@kando/db'
import { clearOutbox, ipHashOf, pruneOldRows } from '@kando/domain'
import { outboxForTests } from '@kando/domain/src/testing'
import { cleanupUsers, EMAIL, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const route = await import('../app/app-api/v1/feedback/route')
const stamp = Date.now()
let n = 0
const newIp = () => `198.51.100.${(stamp + ++n) % 250}-${stamp}-${n}`

const post = async (body: unknown, o: { uid?: string; ip?: string } = {}) => {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  const res = await route.POST(
    new Request('http://localhost/app-api/v1/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost', 'x-vercel-forwarded-for': o.ip ?? newIp(), ...(o.uid ? { cookie: `uid=${o.uid}:${EMAIL(o.uid)}` } : {}) },
      body: raw,
    }),
    { params: Promise.resolve({}) },
  )
  return { status: res.status, body: await res.json().catch(() => null) }
}
const input = (message = 'The app is great') => ({ email: 'someone@example.com', message })
const attempts = async () => (await pool.query('SELECT count(*)::int AS n FROM feedback_attempts')).rows[0].n as number

beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', '')
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'test-secret-not-real-0123')
  clearOutbox()
})
afterEach(() => vi.unstubAllEnvs())
afterAll(async () => {
  await pool.query('DELETE FROM feedback_attempts')
  await cleanupUsers()
})

it('a signed-out message reaches the outbox at the fixed address with replyTo, without any personal id', async () => {
  const r = await post({ ...input('Hello <b>there</b>'), to: 'evil@example.com' })
  expect(r).toEqual({ status: 200, body: { ok: true } })
  const [m, ...rest] = outboxForTests()
  expect(rest).toEqual([])
  expect(m).toMatchObject({ to: 'info@skillweb.space', replyTo: 'someone@example.com', subject: 'Feedback from the app' })
  expect(m!.text).toContain('Hello <b>there</b>')
  expect(m!.html).toContain('&lt;b&gt;')
  expect(m!.text).not.toContain('User id')
})

it('a signed-in message adds the user id and language', async () => {
  await seedUser('fb-in')
  expect((await post(input(), { uid: 'fb-in' })).status).toBe(200)
  expect(outboxForTests()[0]!.text).toContain('User id: fb-in')
  expect(outboxForTests()[0]!.text).toContain('App language: de')
})

it('invalid email, empty and too long messages answer 400 and are not counted or sent', async () => {
  const before = await attempts()
  expect((await post({ email: 'nope', message: 'hi' })).status).toBe(400)
  expect((await post({ email: 'a@b.de', message: '   ' })).status).toBe(400)
  expect((await post({ email: 'a@b.de', message: 'x'.repeat(2001) })).status).toBe(400)
  expect((await post('not json')).status).toBe(400)
  expect(outboxForTests()).toHaveLength(0)
  expect(await attempts()).toBe(before)
})

it('signed out: the second message from one address within the hour is 429, another address is fine', async () => {
  const ip = newIp()
  expect((await post(input(), { ip })).status).toBe(200)
  const second = await post(input(), { ip })
  expect(second.status).toBe(429)
  expect(second.body).toMatchObject({ error: 'RATE_LIMITED' })
  expect(outboxForTests()).toHaveLength(1)
  expect((await post(input())).status).toBe(200)
})

it('signed out: one per day per address even when the last one is older than an hour', async () => {
  const ip = newIp()
  await pool.query("INSERT INTO feedback_attempts (ip_hash, created_at) VALUES ($1, now() - interval '2 hours')", [ipHashOf(new Headers({ 'x-vercel-forwarded-for': ip }))])
  expect((await post(input(), { ip })).status).toBe(429)
})

it('signed in: five per hour, the sixth is 429 whatever the address', async () => {
  await seedUser('fb-six')
  for (let i = 0; i < 5; i++) expect((await post(input(), { uid: 'fb-six' })).status, `call ${i + 1}`).toBe(200)
  expect((await post(input(), { uid: 'fb-six' })).status).toBe(429)
  expect(outboxForTests()).toHaveLength(5)
})

it('signed in: ten per day, the eleventh is 429 when the first ones are older than an hour', async () => {
  await seedUser('fb-day')
  await pool.query("INSERT INTO feedback_attempts (user_id, ip_hash, created_at) SELECT 'fb-day', 'x', now() - interval '3 hours' FROM generate_series(1, 10)")
  expect((await post(input(), { uid: 'fb-day' })).status).toBe(429)
})

it('a failed mail answers 502 and does not count; the next try works', async () => {
  vi.stubEnv('RESEND_API_KEY', 're_test_not_real')
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ name: 'application_error', message: 'x', statusCode: 500 }), { status: 500 }))
  const ip = newIp()
  const before = await attempts()
  const failed = await post(input('secret words'), { ip })
  expect(failed.status).toBe(502)
  expect(failed.body).toMatchObject({ error: 'SEND_FAILED' })
  expect(await attempts()).toBe(before)
  fetchMock.mockRestore()
  vi.stubEnv('RESEND_API_KEY', '')
  expect((await post(input(), { ip })).status).toBe(200)
  expect(await attempts()).toBe(before + 1)
})

it('the message and the email are in no table, and the attempt holds only a hash', async () => {
  const marker = `uniquemarker${stamp}`
  const ip = newIp()
  expect((await post({ email: `${marker}@example.com`, message: `text ${marker}` }, { ip })).status).toBe(200)
  const tables = (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'")).rows.map((r) => r.table_name as string)
  for (const t of tables) {
    const hit = (await pool.query(`SELECT count(*)::int AS n FROM "${t}" x WHERE x::text LIKE $1`, [`%${marker}%`])).rows[0].n
    expect(hit, t).toBe(0)
  }
  const stored = (await pool.query('SELECT ip_hash FROM feedback_attempts ORDER BY created_at DESC LIMIT 1')).rows[0].ip_hash as string
  expect(stored).toMatch(/^[0-9a-f]{64}$/)
  expect(stored).not.toContain(ip)
})

it('the daily clean-up removes attempts older than 2 days and keeps newer ones', async () => {
  await pool.query("INSERT INTO feedback_attempts (ip_hash, created_at) VALUES ('old-fb', now() - interval '49 hours'), ('new-fb', now() - interval '47 hours')")
  const pruned = await pruneOldRows(db, new Date())
  expect(pruned.feedbackAttempts).toBeGreaterThanOrEqual(1)
  expect((await pool.query("SELECT ip_hash FROM feedback_attempts WHERE ip_hash LIKE '%-fb'")).rows).toEqual([{ ip_hash: 'new-fb' }])
})

it('deleting the account removes its attempts', async () => {
  await seedUser('fb-del')
  expect((await post(input(), { uid: 'fb-del' })).status).toBe(200)
  await cleanupUsers()
  expect((await pool.query("SELECT count(*)::int AS n FROM feedback_attempts WHERE user_id = 'fb-del'")).rows[0].n).toBe(0)
})
