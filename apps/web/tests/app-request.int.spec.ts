import { afterAll, beforeAll, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { pool } from '@kando/db'
import { createAppRequest } from '@kando/domain'

// Fake session source: cookie "uid=<id>:<email>" is a session, anything else is not.
const appRequest = createAppRequest(async (request) => {
  const m = /uid=([^:;]+):([^;]+)/.exec(request.headers.get('cookie') ?? '')
  return m ? { id: m[1]!, email: m[2]! } : null
})
const ctx = { params: Promise.resolve({}) }
const as = (id: string) =>
  new Request('http://localhost/x', { headers: { cookie: `uid=${id}:${id}@test.skilled.invalid` } })
const count = async () => Number((await pool.query('SELECT count(*) FROM users')).rows[0].count)

const me = appRequest({ auth: 'required' }, async ({ tx, user }) => {
  const r = await tx.execute(sql`SELECT id, language FROM users`)
  return Response.json({ user, rows: r.rows })
})

beforeAll(async () => {
  await pool.query('CREATE TABLE IF NOT EXISTS wrap_probe (id serial PRIMARY KEY, note text)')
  await pool.query('GRANT INSERT ON wrap_probe TO app_user; GRANT USAGE ON SEQUENCE wrap_probe_id_seq TO app_user')
})
afterAll(async () => {
  await pool.query('DROP TABLE IF EXISTS wrap_probe')
  await pool.query("DELETE FROM users WHERE email LIKE '%@test.skilled.invalid'")
})

it('first contact creates the users row', async () => {
  const res = await me(
    new Request('http://localhost/x?lang=en', { headers: { cookie: 'uid=u1:u1@test.skilled.invalid' } }),
    ctx,
  )
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.user).toMatchObject({ id: 'u1', email: 'u1@test.skilled.invalid', language: 'en', isProvider: false })
  expect(body.rows).toEqual([{ id: 'u1', language: 'en' }])
  // second contact keeps the stored language
  const again = await (await me(as('u1'), ctx)).json()
  expect(again.user.language).toBe('en')
})

it('a forged cookie is 401 and touches nothing', async () => {
  const before = await count()
  const res = await me(
    new Request('http://localhost/x', { headers: { cookie: 'session_token=forged; session_data=forged' } }),
    ctx,
  )
  expect(res.status).toBe(401)
  expect(await res.json()).toEqual({ error: 'Unauthorized' })
  expect(await count()).toBe(before)
})

it('required auth without a cookie is 401', async () => {
  expect((await me(new Request('http://localhost/x'), ctx)).status).toBe(401)
})

it('optional auth without a cookie runs with no user', async () => {
  const h = appRequest({ auth: 'optional' }, async ({ user }) => Response.json({ user }))
  expect(await (await h(new Request('http://localhost/x'), ctx)).json()).toEqual({ user: null })
})

it('a handler error rolls back and returns 500', async () => {
  const h = appRequest({ auth: 'required' }, async ({ tx }) => {
    await tx.execute(sql`INSERT INTO wrap_probe (note) VALUES ('x')`)
    throw new Error('boom')
  })
  const res = await h(as('u1'), ctx)
  expect(res.status).toBe(500)
  expect(await res.json()).toEqual({ error: 'Server error' })
  expect((await pool.query('SELECT count(*) FROM wrap_probe')).rows[0].count).toBe('0')
})

it('a body over maxBodyBytes is 413 before the handler runs', async () => {
  const h = appRequest({ auth: 'required', maxBodyBytes: 10 }, async () => Response.json({ ok: true }))
  const res = await h(
    new Request('http://localhost/x', {
      method: 'POST',
      body: 'x'.repeat(50),
      headers: { cookie: 'uid=u1:u1@test.skilled.invalid' },
    }),
    ctx,
  )
  expect(res.status).toBe(413)
})

it('user A cannot read user B through the wrapper', async () => {
  await me(as('ua'), ctx)
  await me(as('ub'), ctx)
  const a = await (await me(as('ua'), ctx)).json()
  expect(a.rows).toEqual([{ id: 'ua', language: 'de' }])
})

it('app_user cannot write staff columns of its own row', async () => {
  const h = appRequest({ auth: 'required' }, async ({ tx, user }) => {
    await tx.execute(sql`UPDATE users SET staff_role = 'admin' WHERE id = ${user!.id}`)
    return Response.json({})
  })
  expect((await h(as('ua'), ctx)).status).toBe(500)
  expect((await pool.query("SELECT staff_role FROM users WHERE id='ua'")).rows[0].staff_role).toBeNull()
})
