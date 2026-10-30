import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { asUser, pool } from '@kando/db'
import { call, cleanupUsers, EMAIL, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const tokens = await import('../app/app-api/v1/push-tokens/route')
const push = await import('../app/app-api/v1/me/push/route')
const meRoute = await import('../app/app-api/v1/me/route')

const U = { a: 'pt-a', b: 'pt-b', c: 'pt-c' }
const TOKEN = (s: string) => `ExponentPushToken[${s}]`
const save = (uid: string, token: string, platform = 'android') => call(tokens.POST, uid, 'POST', { token, platform })
const held = async (token: string) => (await pool.query('SELECT user_id, platform, created_at, last_seen_at FROM push_tokens WHERE token = $1', [token])).rows
const denied = { cause: { message: expect.stringMatching(/permission denied|row-level security/) } }

beforeAll(async () => {
  await cleanupUsers()
  for (const u of Object.values(U)) await seedUser(u)
})
afterAll(cleanupUsers)

it('a token is saved once and lastSeenAt updates on the second save', async () => {
  expect((await save(U.a, TOKEN('one'))).status).toBe(204)
  const [first] = await held(TOKEN('one'))
  expect(first).toMatchObject({ user_id: U.a, platform: 'android' })
  await pool.query("UPDATE push_tokens SET last_seen_at = now() - interval '1 day' WHERE token = $1", [TOKEN('one')])
  expect((await save(U.a, TOKEN('one'), 'ios')).status).toBe(204)
  const rows = await held(TOKEN('one'))
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ user_id: U.a, platform: 'ios' })
  expect(rows[0].created_at).toEqual(first.created_at)
  expect(rows[0].last_seen_at.getTime()).toBeGreaterThan(Date.now() - 60_000)
})

it('a token saved by a second user moves to them', async () => {
  await save(U.a, TOKEN('phone'))
  // the phone changes hands: A signs out without the delete reaching the server, B signs in on the same device
  expect((await save(U.b, TOKEN('phone'))).status).toBe(204)
  expect((await held(TOKEN('phone'))).map((r) => r.user_id)).toEqual([U.b])
  expect((await pool.query('SELECT token FROM push_tokens WHERE user_id = $1 AND token = $2', [U.a, TOKEN('phone')])).rows).toEqual([])
})

it("a user cannot read another user's tokens", async () => {
  await save(U.c, TOKEN('c-own'))
  const read = async (uid: string) => (await asUser(uid, (tx) => tx.execute(sql`SELECT token FROM push_tokens`))).rows.map((r) => r.token)
  expect(await read(U.c)).toEqual([TOKEN('c-own')])
  expect(await read(U.a)).not.toContain(TOKEN('c-own'))
  expect((await asUser(null, (tx) => tx.execute(sql`SELECT token FROM push_tokens`))).rows).toEqual([])
  // no change, removal or forged row for someone else
  const upd = await asUser(U.a, (tx) => tx.execute(sql`UPDATE push_tokens SET user_id = ${U.a} WHERE token = ${TOKEN('c-own')}`))
  expect(upd.rowCount).toBe(0)
  const del = await asUser(U.a, (tx) => tx.execute(sql`DELETE FROM push_tokens WHERE token = ${TOKEN('c-own')}`))
  expect(del.rowCount).toBe(0)
  await expect(asUser(U.a, (tx) => tx.execute(sql`INSERT INTO push_tokens (user_id, token, platform) VALUES (${U.c}, ${TOKEN('forged')}, 'ios')`))).rejects.toMatchObject(denied)
  expect((await held(TOKEN('c-own'))).map((r) => r.user_id)).toEqual([U.c])
  // the DTO of the person never carries a token
  expect(JSON.stringify(await (await call(meRoute.GET, U.c)).json())).not.toContain('ExponentPushToken')
})

it('DELETE removes only the caller\'s own token, and twice is fine', async () => {
  await save(U.a, TOKEN('del'))
  expect((await call(tokens.DELETE, U.b, 'DELETE', { token: TOKEN('del') })).status).toBe(204)
  expect((await held(TOKEN('del'))).map((r) => r.user_id)).toEqual([U.a])
  expect((await call(tokens.DELETE, U.a, 'DELETE', { token: TOKEN('del') })).status).toBe(204)
  expect(await held(TOKEN('del'))).toEqual([])
  expect((await call(tokens.DELETE, U.a, 'DELETE', { token: TOKEN('del') })).status).toBe(204)
})

it('a token that is not an Expo push token, or a platform outside ios and android, is 400', async () => {
  expect((await save(U.a, 'abc')).status).toBe(400)
  expect((await save(U.a, TOKEN('x'), 'web')).status).toBe(400)
  expect((await save(U.a, `${TOKEN('x')}${'y'.repeat(300)}`)).status).toBe(400)
  expect(await held(TOKEN('x'))).toEqual([])
})

it('settings default to on and can be switched off', async () => {
  expect(await (await call(push.GET, U.a)).json()).toEqual({ chat: true, reminders: true })
  const off = await call(push.PATCH, U.a, 'PATCH', { chat: false })
  expect(off.status).toBe(200)
  expect(await off.json()).toEqual({ chat: false, reminders: true })
  expect(await (await call(push.PATCH, U.a, 'PATCH', { reminders: false })).json()).toEqual({ chat: false, reminders: false })
  expect(await (await call(push.GET, U.a)).json()).toEqual({ chat: false, reminders: false })
  // another person's switches are untouched
  expect(await (await call(push.GET, U.b)).json()).toEqual({ chat: true, reminders: true })
  expect((await call(push.PATCH, U.a, 'PATCH', { chat: 'no' })).status).toBe(400)
  expect((await pool.query('SELECT push_chat, push_reminders FROM users WHERE id = $1', [U.a])).rows[0]).toEqual({ push_chat: false, push_reminders: false })
})

it('signed out is 401, an unconfirmed email 403, a suspended person cannot save a token', async () => {
  const anon = (h: typeof tokens.POST, method: string, body?: unknown) =>
    h(new Request('http://localhost/x', { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), { params: Promise.resolve({}) })
  expect((await anon(tokens.POST, 'POST', { token: TOKEN('anon'), platform: 'ios' })).status).toBe(401)
  expect((await anon(tokens.DELETE, 'DELETE', { token: TOKEN('anon') })).status).toBe(401)
  expect((await anon(push.GET, 'GET')).status).toBe(401)
  expect((await anon(push.PATCH, 'PATCH', { chat: false })).status).toBe(401)
  const unverified = await tokens.POST(
    new Request('http://localhost/x', { method: 'POST', headers: { origin: 'http://localhost', cookie: `uid=${U.a}:${EMAIL(U.a)}; verified=0`, 'content-type': 'application/json' }, body: JSON.stringify({ token: TOKEN('nv'), platform: 'ios' }) }),
    { params: Promise.resolve({}) },
  )
  expect(unverified.status).toBe(403)
  await pool.query("UPDATE users SET suspended_until = now() + interval '1 day' WHERE id = $1", [U.c])
  expect((await save(U.c, TOKEN('susp'))).status).toBe(403)
  expect(await held(TOKEN('susp'))).toEqual([])
})
