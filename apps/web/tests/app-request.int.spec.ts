import { afterAll, beforeAll, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { appPool, db, pool } from '@kando/db'
import { parseBody, ServiceInputSchema } from '@kando/contract'
import { createAppRequest } from '@kando/domain'

// Fake session source: cookie "uid=<id>:<email>" is a (confirmed) session, anything else is not.
const appRequest = createAppRequest(async (request) => {
  const m = /uid=([^:;]+):([^;]+)/.exec(request.headers.get('cookie') ?? '')
  return m ? { id: m[1]!, email: m[2]!, emailVerified: true } : null
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
  await pool.query(
    'GRANT INSERT ON wrap_probe TO app_user; GRANT USAGE ON SEQUENCE wrap_probe_id_seq TO app_user',
  )
})
afterAll(async () => {
  await pool.query('DROP TABLE IF EXISTS wrap_probe')
  await pool.query("DELETE FROM users WHERE email LIKE '%@test.skilled.invalid'")
})

it('first contact creates the users row', async () => {
  const res = await me(
    new Request('http://localhost/x?lang=en', {
      headers: { cookie: 'uid=u1:u1@test.skilled.invalid' },
    }),
    ctx,
  )
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.user).toMatchObject({
    id: 'u1',
    email: 'u1@test.skilled.invalid',
    language: 'en',
    isProvider: false,
  })
  expect(body.rows).toEqual([{ id: 'u1', language: 'en' }])
  // second contact keeps the stored language
  const again = await (await me(as('u1'), ctx)).json()
  expect(again.user.language).toBe('en')
})

it('a forged cookie is 401 and touches nothing', async () => {
  const before = await count()
  const res = await me(
    new Request('http://localhost/x', {
      headers: { cookie: 'session_token=forged; session_data=forged' },
    }),
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

it('an unconfirmed email: 403 where auth is required, signed out where optional; never a users row', async () => {
  const unconfirmed = createAppRequest(async () => ({ id: 'u-unv', email: 'u-unv@test.skilled.invalid', emailVerified: false }))
  const required = await unconfirmed({ auth: 'required' }, async () => Response.json({ ran: true }))(new Request('http://localhost/x'), ctx)
  expect(required.status).toBe(403)
  expect(await required.json()).toEqual({ error: 'EMAIL_NOT_VERIFIED' })
  const optional = unconfirmed({ auth: 'optional' }, async ({ user }) => Response.json({ user }))
  expect(await (await optional(new Request('http://localhost/x'), ctx)).json()).toEqual({ user: null })
  expect((await pool.query("SELECT 1 FROM users WHERE id = 'u-unv'")).rows).toHaveLength(0)
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
  const h = appRequest({ auth: 'required', maxBodyBytes: 10 }, async () =>
    Response.json({ ok: true }),
  )
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
  expect(
    (await pool.query("SELECT staff_role FROM users WHERE id='ua'")).rows[0].staff_role,
  ).toBeNull()
})

it('first contact with a changed email updates the row', async () => {
  await me(as('ue'), ctx)
  const res = await me(
    new Request('http://localhost/x', {
      headers: { cookie: 'uid=ue:ue-new@test.skilled.invalid' },
    }),
    ctx,
  )
  expect(res.status).toBe(200)
  expect((await pool.query("SELECT email FROM users WHERE id='ue'")).rows[0].email).toBe(
    'ue-new@test.skilled.invalid',
  )
})

it('a second id with the same email gets 409 and no row is written', async () => {
  const before = await count()
  const res = await me(
    new Request('http://localhost/x', { headers: { cookie: 'uid=other:ua@test.skilled.invalid' } }),
    ctx,
  )
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'Email belongs to another account' })
  expect(await count()).toBe(before)
})

it('a thrown 400 Response is returned unchanged', async () => {
  const h = appRequest({ auth: 'required' }, async ({ request }) => {
    await parseBody(ServiceInputSchema, request)
    return Response.json({ ok: true })
  })
  const res = await h(
    new Request('http://localhost/x', {
      method: 'POST',
      body: '{"title":""}',
      headers: { cookie: 'uid=u9:u9@test.skilled.invalid' },
    }),
    ctx,
  )
  expect(res.status).toBe(400)
  const body = (await res.json()) as { error: string; issues: unknown[] }
  expect(body.error).toBe('Invalid input')
  expect(body.issues.length).toBeGreaterThan(0)
})

it('a suspended person: writes are 403 SUSPENDED, reads work, an expired date is not suspended', async () => {
  const write = appRequest({ auth: 'required' }, async () => Response.json({ ran: true }))
  const req = (id: string, method: string) => new Request('http://localhost/x', { method, headers: { cookie: `uid=${id}:${id}@test.skilled.invalid` } })
  await me(as('usus'), ctx)
  await pool.query("UPDATE users SET suspended_until = now() + interval '1 day' WHERE id = 'usus'")
  const blocked = await write(req('usus', 'POST'), ctx)
  expect(blocked.status).toBe(403)
  expect(await blocked.json()).toEqual({ error: 'SUSPENDED' })
  expect((await write(req('usus', 'GET'), ctx)).status).toBe(200)
  await pool.query("UPDATE users SET suspended_until = now() - interval '1 day' WHERE id = 'usus'")
  expect((await write(req('usus', 'POST'), ctx)).status).toBe(200)
})

it('a suspended person can still erase their own data (DELETE) and use a route marked allowWhenSuspended, never create or edit', async () => {
  const run = async () => Response.json({ ran: true })
  const plain = appRequest({ auth: 'required' }, run)
  const open = appRequest({ auth: 'required', allowWhenSuspended: true }, run)
  const req = (method: string) => new Request('http://localhost/x', { method, headers: { cookie: 'uid=usdel:usdel@test.skilled.invalid' } })
  await me(as('usdel'), ctx)
  await pool.query("UPDATE users SET suspended_until = now() + interval '1 day' WHERE id = 'usdel'")
  expect((await plain(req('DELETE'), ctx)).status).toBe(200)
  for (const m of ['POST', 'PUT', 'PATCH']) expect((await plain(req(m), ctx)).status).toBe(403)
  expect((await open(req('POST'), ctx)).status).toBe(200)
})

const xmin = async (id: string) => (await pool.query('SELECT xmin::text AS x FROM users WHERE id = $1', [id])).rows[0].x
const asEmail = (id: string, email: string) => new Request('http://localhost/x', { headers: { cookie: `uid=${id}:${email}` } })

it('a known user with an unchanged email is not rewritten', async () => {
  await me(as('ux1'), ctx)
  const before = await xmin('ux1')
  expect((await me(as('ux1'), ctx)).status).toBe(200)
  expect(await xmin('ux1')).toBe(before)
})

it('an email changed in Neon Auth is synced', async () => {
  await me(as('ux2'), ctx)
  const res = await me(asEmail('ux2', 'ux2-new@test.skilled.invalid'), ctx)
  expect((await res.json()).user.email).toBe('ux2-new@test.skilled.invalid')
  expect((await pool.query("SELECT email FROM users WHERE id='ux2'")).rows[0].email).toBe('ux2-new@test.skilled.invalid')
})

const busy = () => appPool.totalCount - appPool.idleCount

it('an after-transaction answer runs once the transaction committed', async () => {
  const after = appRequest({ auth: 'required' }, async ({ tx }) => {
    await tx.execute(sql`INSERT INTO wrap_probe (note) VALUES ('after-answer')`)
    return async () => {
      const seen = await db.execute(sql`SELECT 1 FROM wrap_probe WHERE note = 'after-answer'`)
      return Response.json({ seen: seen.rows.length, busy: busy() })
    }
  })
  const res = await after(as('u-after'), ctx)
  expect(await res.json()).toEqual({ seen: 1, busy: 0 })
})

it('a Response thrown by an after-transaction answer is the answer', async () => {
  const after = appRequest({ auth: 'required' }, async () => async () => {
    throw Response.json({ error: 'x' }, { status: 409 })
  })
  const res = await after(as('u-after'), ctx)
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'x' })
})
