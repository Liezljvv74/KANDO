import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { db, pool } from '@kando/db'
import { appPool } from '@kando/db/src/client'
import { parseBody, ServiceInputSchema } from '@kando/contract'
import { AuthUnavailableError, clearOutbox, createAppRequest, finishJob, sendEmail } from '@kando/domain'
import { outboxForTests } from '@kando/domain/src/testing'
import { t } from '@kando/i18n'
import { cleanupUsers, EMAIL, seedBase, seedProvider, seedUser } from './helpers'

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
  await cleanupUsers()
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

it('a 429 from the session lookup is 503 AUTH_BUSY', async () => {
  const busy = createAppRequest(async () => {
    throw new AuthUnavailableError('auth status 429')
  })
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  const ran: string[] = []
  const run = async () => (ran.push('handler'), Response.json({ ran: true }))
  const req = (method: string) => new Request('http://localhost/x', { method, headers: { origin: 'http://localhost', cookie: 'session_token=secret-token-value' } })
  for (const [auth, method] of [['required', 'GET'], ['required', 'POST'], ['optional', 'POST']] as const) {
    const res = await busy({ auth }, run)(req(method), ctx)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'AUTH_BUSY' })
  }
  expect(ran).toEqual([])
  // An optional public read is still served, as anonymous.
  const read = await busy({ auth: 'optional' }, async ({ user }) => Response.json({ user }))(req('GET'), ctx)
  expect(await read.json()).toEqual({ user: null })
  const lines = spy.mock.calls.map((c) => c.join(' '))
  expect(lines.some((l) => l.includes('429'))).toBe(true)
  expect(lines.join('\n')).not.toContain('secret-token-value')
  vi.restoreAllMocks()
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
      headers: { origin: 'http://localhost', cookie: 'uid=u1:u1@test.skilled.invalid' },
    }),
    ctx,
  )
  expect(res.status).toBe(413)
})

it('an upload route without Content-Length is 411 before the handler runs', async () => {
  const ran: string[] = []
  const h = appRequest(
    { auth: 'required', maxBodyBytes: 100, prepare: async () => void ran.push('prepare') },
    async () => {
      ran.push('handler')
      return Response.json({ ok: true })
    },
  )
  const res = await h(
    new Request('http://localhost/x', { method: 'POST', body: 'small', headers: { origin: 'http://localhost', cookie: 'uid=u1:u1@test.skilled.invalid' } }),
    ctx,
  )
  expect(res.status).toBe(411)
  expect(await res.json()).toEqual({ error: 'LENGTH_REQUIRED' })
  expect(ran).toEqual([])
})

it('a body larger than declared is cut at the cap: 413', async () => {
  const max = 10
  let pulled = 0
  // Declares 5 bytes, then never ends: reading it to the end would hang the test.
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      pulled++
      c.enqueue(new Uint8Array([120]))
    },
  })
  const ran: string[] = []
  const h = appRequest({ auth: 'required', maxBodyBytes: max }, async () => {
    ran.push('handler')
    return Response.json({ ok: true })
  })
  const res = await h(
    new Request('http://localhost/x', {
      method: 'POST',
      body,
      duplex: 'half',
      headers: { origin: 'http://localhost', cookie: 'uid=u1:u1@test.skilled.invalid', 'content-length': '5' },
    } as RequestInit),
    ctx,
  )
  expect(res.status).toBe(413)
  expect(ran).toEqual([])
  expect(pulled).toBeLessThan(max + 10) // stopped near max + 1, not read on
}, 10_000)

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

it('an answer is private, no-store unless the handler set Cache-Control', async () => {
  const plain = appRequest({ auth: 'optional' }, async () => Response.json({ ok: true }))
  expect((await plain(new Request('http://localhost/x'), ctx)).headers.get('cache-control')).toBe('private, no-store')
  const own = appRequest({ auth: 'optional' }, async () => Response.json({ ok: true }, { headers: { 'Cache-Control': 'public, max-age=60' } }))
  expect((await own(new Request('http://localhost/x'), ctx)).headers.get('cache-control')).toBe('public, max-age=60')
  const later = appRequest({ auth: 'optional' }, async () => async () => Response.json({ ok: true }))
  expect((await later(new Request('http://localhost/x'), ctx)).headers.get('cache-control')).toBe('private, no-store')
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
      headers: { origin: 'http://localhost', cookie: 'uid=u9:u9@test.skilled.invalid' },
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
  const req = (id: string, method: string) => new Request('http://localhost/x', { method, headers: { origin: 'http://localhost', cookie: `uid=${id}:${id}@test.skilled.invalid` } })
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
  const req = (method: string) => new Request('http://localhost/x', { method, headers: { origin: 'http://localhost', cookie: 'uid=usdel:usdel@test.skilled.invalid' } })
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

/** A request wrapper whose scheduler only stores the job (as Next's after() would run it once the answer is sent). */
function scheduled() {
  const jobs: (() => Promise<void>)[] = []
  const wrap = createAppRequest(
    async (request) => {
      const m = /uid=([^:;]+):([^;]+)/.exec(request.headers.get('cookie') ?? '')
      return m ? { id: m[1]!, email: m[2]!, emailVerified: true } : null
    },
    { schedule: (w) => void jobs.push(w) },
  )
  return { wrap, jobs }
}

it('the response is returned before after-commit work and sends run', async () => {
  vi.stubEnv('RESEND_API_KEY', '')
  clearOutbox()
  const { wrap, jobs } = scheduled()
  const ran: string[] = []
  const h = wrap({ auth: 'required' }, async ({ afterCommit }) => {
    await sendEmail({ to: 'in-tx@test.skilled.invalid', lang: 'en', template: 'document-approved', params: { requirement: 'permit' } })
    afterCommit(async () => void ran.push('after-commit'))
    return Response.json({ ok: true })
  })
  const res = await h(as('u-sched'), ctx)
  expect(res.status).toBe(200)
  expect(outboxForTests()).toHaveLength(0)
  expect(ran).toEqual([])
  expect(jobs).toHaveLength(1)
  await jobs[0]!()
  expect(ran).toEqual(['after-commit'])
  expect(outboxForTests().map((m) => m.to)).toEqual(['in-tx@test.skilled.invalid'])
  vi.unstubAllEnvs()
})

it('notices of a committed owner step go out when the request then fails', async () => {
  vi.stubEnv('RESEND_API_KEY', '')
  clearOutbox()
  const { categoryId } = await seedBase()
  await seedUser('aq-cust')
  const providerId = await seedProvider('aq-owner', { name: 'Aq Owner', categoryId, price: 100 })
  const service = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [providerId])).rows[0].id
  const startAt = new Date(Date.now() - 2 * 3_600_000)
  const id = (
    await pool.query(
      `INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, pay_by, paid_at, payment_ref, commission_rate)
       VALUES ('aq-cust', $1, $2, 'direct', 'confirmed', $3, 60, $3::timestamptz - interval '2 days', $3::timestamptz - interval '2 days', 'pi_aq_' || gen_random_uuid(), 0.12) RETURNING id`,
      [providerId, service, startAt],
    )
  ).rows[0].id as string
  const { wrap, jobs } = scheduled()
  const h = wrap({ auth: 'required' }, async ({ tx, user }) => {
    await finishJob(tx, user!.id, id, {})
    throw new Error('after the finish')
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const res = await h(as('aq-owner'), ctx)
  expect(res.status).toBe(500)
  expect((await pool.query('SELECT status FROM bookings WHERE id = $1', [id])).rows[0].status).toBe('finished')
  expect(outboxForTests()).toHaveLength(0)
  for (const job of jobs) await job()
  const mail = outboxForTests().find((m) => m.to === EMAIL('aq-cust'))
  expect(mail?.subject).toBe(t('de', 'email.jobFinished.subject'))
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
