import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { QuoteSchema, RequestSchema } from '@kando/contract'
import { requestTime, call, cleanupUsers, expireQuotes, seedBase, seedProvider, seedUser, relaxLimits } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const requests = await import('../app/app-api/v1/requests/route')
const requestOne = await import('../app/app-api/v1/requests/[id]/route')
const quotes = await import('../app/app-api/v1/requests/[id]/quotes/route')
const accept = await import('../app/app-api/v1/quotes/[id]/accept/route')
const confirm = await import('../app/app-api/v1/quotes/[id]/confirm/route')
const withdraw = await import('../app/app-api/v1/requests/[id]/withdraw/route')
const decline = await import('../app/app-api/v1/requests/[id]/decline/route')

const U = { cust: 'rq-cust', owner: 'rq-owner', remote: 'rq-remote', susp: 'rq-susp', draft: 'rq-draft', third: 'rq-third', quiet: 'rq-quiet', silent: 'rq-silent' }
let pOwner: string, pRemote: string, pSusp: string, pDraft: string, pQuiet: string, pSilent: string

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  for (const u of [U.cust, U.third]) await seedUser(u)
  pOwner = await seedProvider(U.owner, { name: 'Rq Owner', categoryId })
  pRemote = await seedProvider(U.remote, { name: 'Rq Remote', categoryId, remote: true })
  pSusp = await seedProvider(U.susp, { name: 'Rq Susp', categoryId, suspended: true })
  pDraft = await seedProvider(U.draft, { name: 'Rq Draft', categoryId, status: 'draft' })
  pQuiet = await seedProvider(U.quiet, { name: 'Rq Quiet', categoryId })
  pSilent = await seedProvider(U.silent, { name: 'Rq Silent', categoryId })
})
afterAll(cleanupUsers)

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()
const newRequest = async (providerId = pOwner, as = U.cust) => {
  await relaxLimits(as)
  return RequestSchema.parse(await (await call(requests.POST, as, 'POST', { providerId, description: 'Fix the fence', ...requestTime() })).json())
}
const quote = (reqId: string, as: string, body: object = { amount: 100, scope: 'Fence' }) => call(quotes.POST, as, 'POST', body, { id: reqId })
const confirming = (quoteId: string, as: string, body: object = {}) => call(confirm.POST, as, 'POST', body, { id: quoteId })

it('customer creates a request; provider sees it incoming', async () => {
  const res = await call(requests.POST, U.cust, 'POST', { providerId: pOwner, description: 'Fix the fence', ...requestTime() })
  expect(res.status).toBe(201)
  const r = RequestSchema.parse(await res.json())
  expect(r).toMatchObject({ customerId: U.cust, providerId: pOwner, status: 'open' })
  expect(new Date(r.answerBy).getTime() - new Date(r.createdAt).getTime()).toBe(3 * 86_400_000)
  for (const uid of [U.owner, U.cust]) expect(RequestSchema.parse(await (await call(requestOne.GET, uid, 'GET', undefined, { id: r.id })).json()).id).toBe(r.id) // both parties read it
  // createRequest runs as the app role, which has no grant on job_number: the database numbers the row
  expect((await pool.query('SELECT job_number FROM requests WHERE id = $1', [r.id])).rows[0].job_number).toBeGreaterThanOrEqual(1000)
})

it('request to an unpublished or suspended provider is 404', async () => {
  for (const providerId of [pDraft, pSusp, crypto.randomUUID()]) {
    expect((await call(requests.POST, U.cust, 'POST', { providerId, description: 'x', ...requestTime() })).status).toBe(404)
  }
})

it('own service request is 400', async () => {
  expect((await call(requests.POST, U.owner, 'POST', { providerId: pOwner, description: 'x', ...requestTime() })).status).toBe(400)
})

it('provider sends a quote; a second quote supersedes the first', async () => {
  const r = await newRequest()
  expect((await quote(r.id, U.cust)).status).toBe(404) // the customer cannot quote
  expect((await quote(r.id, U.remote)).status).toBe(404) // nor another provider
  const q1 = QuoteSchema.parse(await (await quote(r.id, U.owner)).json())
  expect(q1).toMatchObject({ version: 1, status: 'sent', amount: 100, currency: 'EUR' })
  expect(new Date(q1.expiresAt).getTime() - new Date(q1.createdAt).getTime()).toBe(7 * 86_400_000)
  const res2 = await quote(r.id, U.owner, { amount: 120, scope: 'Fence and gate' })
  expect(res2.status).toBe(201)
  expect(QuoteSchema.parse(await res2.json()).version).toBe(2)
  const rows = (await pool.query('SELECT version, status FROM quotes WHERE request_id = $1 ORDER BY version', [r.id])).rows
  expect(rows).toEqual([{ version: 1, status: 'superseded' }, { version: 2, status: 'sent' }])
  expect((await pool.query('SELECT status FROM requests WHERE id = $1', [r.id])).rows[0].status).toBe('quoted')
  const list = await (await call(quotes.GET, U.cust, 'GET', undefined, { id: r.id })).json()
  expect(list.docs.map((d: { version: number }) => d.version)).toEqual([2, 1])
  expect((await confirming(q1.id, U.cust)).status).toBe(409) // the superseded quote can no longer be confirmed
})

it('an ordinary quote posted to /accept is refused with 409 use-confirm and nothing changes (it is confirmed; /accept is for additional tasks)', async () => {
  const r = await newRequest()
  const q = QuoteSchema.parse(await (await quote(r.id, U.owner, { amount: 99.5, scope: 'Fence' })).json())
  const res = await call(accept.POST, U.cust, 'POST', {}, { id: q.id })
  expect([res.status, (await res.json()).error]).toEqual([409, 'use-confirm'])
  expect((await call(accept.POST, U.cust, 'POST', { startAt: day(10), durationMin: 60, onSite: true }, { id: q.id })).status).toBe(400) // a time is no longer part of the body
  expect((await call(accept.POST, U.third, 'POST', {}, { id: q.id })).status).toBe(404) // a stranger still learns nothing
  const st = (await pool.query('SELECT (SELECT status FROM quotes WHERE id = $1) q, (SELECT status FROM requests WHERE id = $2) r, (SELECT count(*)::int FROM bookings WHERE quote_id = $1) b', [q.id, r.id])).rows[0]
  expect(st).toEqual({ q: 'sent', r: 'quoted', b: 0 })
  expect((await confirming(q.id, U.cust)).status).toBe(200) // the way to book it
})

it('a quote with a past time or a negative amount is 400', async () => {
  const r = await newRequest()
  expect((await quote(r.id, U.owner, { amount: 10, scope: 's', startAt: day(-1) })).status).toBe(400)
  expect((await quote(r.id, U.owner, { amount: -5, scope: 's' })).status).toBe(400)
})

it('confirming an expired quote is 409', async () => {
  const r = await newRequest()
  const q = QuoteSchema.parse(await (await quote(r.id, U.owner)).json())
  await expireQuotes('id = $1', [q.id])
  expect((await confirming(q.id, U.cust)).status).toBe(409)
})

it('two concurrent confirms: one 200, one 409', async () => {
  const r = await newRequest()
  const q = QuoteSchema.parse(await (await quote(r.id, U.owner)).json())
  // hold the request's advisory lock: both confirms must wait for it (proves they take it), then exactly one wins
  const holder = await pool.connect()
  let both: Promise<Response[]>
  try {
    await holder.query('BEGIN')
    await holder.query("SELECT pg_advisory_xact_lock(hashtext('booking_request'), hashtext($1))", [r.id])
    both = Promise.all([confirming(q.id, U.cust), confirming(q.id, U.cust)])
    await new Promise((ok) => setTimeout(ok, 500))
    expect((await pool.query('SELECT count(*)::int n FROM bookings WHERE quote_id = $1', [q.id])).rows[0].n).toBe(0)
    await holder.query('COMMIT')
  } finally {
    holder.release()
  }
  const res = await both
  const st = (await pool.query('SELECT (SELECT status FROM quotes WHERE id = $1) q, (SELECT status FROM requests WHERE id = $2) r', [q.id, r.id])).rows[0]
  expect(st).toEqual({ q: 'accepted', r: 'booked' })
  expect(res.map((x) => x.status).sort()).toEqual([200, 409])
  expect((await pool.query('SELECT count(*)::int n FROM bookings WHERE quote_id = $1', [q.id])).rows[0].n).toBe(1)
})

it('a third user gets 404 on every route; the provider cannot confirm', async () => {
  const r = await newRequest()
  const q = QuoteSchema.parse(await (await quote(r.id, U.owner)).json())
  expect((await call(requestOne.GET, U.third, 'GET', undefined, { id: r.id })).status).toBe(404)
  expect((await call(quotes.GET, U.third, 'GET', undefined, { id: r.id })).status).toBe(404)
  expect((await quote(r.id, U.third)).status).toBe(404)
  expect((await confirming(q.id, U.third)).status).toBe(404)
  expect((await confirming(q.id, U.owner)).status).toBe(403) // the provider read it, only the customer confirms
  expect((await call(requestOne.GET, U.cust, 'GET', undefined, { id: r.id })).status).toBe(200)
  expect((await call(requestOne.GET, U.owner, 'GET', undefined, { id: r.id })).status).toBe(200)
  expect((await pool.query('SELECT status FROM quotes WHERE id = $1', [q.id])).rows[0].status).toBe('sent')
})

const at = (n: number) => new Date(Date.now() + n * 86_400_000)
const sendAt = async (reqId: string, when: Date, uid = U.owner) => {
  const { sendQuote } = await import('@kando/domain')
  const { asUser } = await import('@kando/db')
  return asUser(uid, (tx) => sendQuote(tx, uid, reqId, { amount: 80, scope: 'rev' }, when)).then(() => 201, (e: Response) => e.status)
}

it('the 3-day deadline binds the first quote only; a revision follows while the last quote is valid', async () => {
  const r1 = await newRequest()
  expect(await sendAt(r1.id, at(1))).toBe(201)
  expect(await sendAt(r1.id, at(5))).toBe(201) // day 5, quote of day 1 still valid (7 days)
  const r2 = await newRequest()
  expect(await sendAt(r2.id, at(4))).toBe(409) // first quote after answerBy
  const r3 = await newRequest()
  expect(await sendAt(r3.id, at(1))).toBe(201)
  expect(await sendAt(r3.id, at(9))).toBe(409) // previous quote expired
})

it('a booked request takes no further quote', async () => {
  const r = await newRequest()
  const q = QuoteSchema.parse(await (await quote(r.id, U.owner)).json())
  expect((await confirming(q.id, U.cust)).status).toBe(200)
  expect((await quote(r.id, U.owner)).status).toBe(409)
})

it('a provider suspended or unpublished after the request cannot quote, and the quote cannot be confirmed', async () => {
  const gone = async (change: string) => {
    const r = await newRequest(pRemote)
    const q = QuoteSchema.parse(await (await quote(r.id, U.remote)).json())
    const r2 = await newRequest(pRemote, U.third) // another customer: one open request per pair
    await pool.query(change)
    const out = [(await quote(r2.id, U.remote)).status, (await confirming(q.id, U.cust)).status]
    await pool.query("UPDATE providers SET status = 'published', suspended_until = NULL WHERE id = $1", [pRemote])
    return out
  }
  expect(await gone(`UPDATE providers SET suspended_until = now() + interval '1 day' WHERE id = '${pRemote}'`)).toEqual([409, 404]) // confirm: the suspended provider's row is hidden from the customer
  expect(await gone(`UPDATE providers SET status = 'draft' WHERE id = '${pRemote}'`)).toEqual([409, 404])
})

const closing = (route: typeof withdraw, reqId: string, as: string) => call(route.POST, as, 'POST', undefined, { id: reqId })
const statusOf = async (table: 'requests' | 'quotes', id: string) => (await pool.query(`SELECT status FROM ${table} WHERE id = $1`, [id])).rows[0].status
const told = async (uid: string, kind: string, requestId: string) =>
  (await pool.query('SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND kind = $2 AND payload->>$4 = $3', [uid, kind, requestId, 'requestId'])).rows[0].n

it('the customer withdraws an open and a quoted request; the provider is told', async () => {
  const open = await newRequest()
  const res = await closing(withdraw, open.id, U.cust)
  expect(res.status).toBe(200)
  expect(RequestSchema.parse(await res.json())).toMatchObject({ id: open.id, status: 'withdrawn' })
  expect(await told(U.owner, 'request-withdrawn', open.id)).toBe(1)
  const quoted = await newRequest()
  const q = QuoteSchema.parse(await (await quote(quoted.id, U.owner)).json())
  expect((await closing(withdraw, quoted.id, U.cust)).status).toBe(200)
  expect([await statusOf('requests', quoted.id), await statusOf('quotes', q.id)]).toEqual(['withdrawn', 'declined'])
  expect(await told(U.owner, 'request-withdrawn', quoted.id)).toBe(1)
  expect((await confirming(q.id, U.cust)).status).toBe(409) // nothing left to confirm
  expect((await quote(quoted.id, U.owner)).status).toBe(409) // nor to quote
})

it('the provider declines; the customer is told; the request leaves the pair limit (5 live requests per pair)', async () => {
  const r = await newRequest()
  const again = () => call(requests.POST, U.cust, 'POST', { providerId: pOwner, description: 'Again', ...requestTime() })
  for (let i = 0; i < 4; i++) expect((await again()).status).toBe(201) // several requests to one provider: one per job
  expect((await again()).status).toBe(409) // the 6th live request
  const res = await closing(decline, r.id, U.owner)
  expect(res.status).toBe(200)
  expect(RequestSchema.parse(await res.json())).toMatchObject({ id: r.id, status: 'declined' })
  expect(await told(U.cust, 'request-declined', r.id)).toBe(1)
  expect((await again()).status).toBe(201)
})

it('the other side gets 403, a stranger 404, a booked request 409', async () => {
  const r = await newRequest()
  for (const [route, wrong] of [[withdraw, U.owner], [decline, U.cust]] as const) {
    const res = await closing(route, r.id, wrong)
    expect([res.status, (await res.json()).error]).toEqual([403, 'wrong-side'])
    expect((await closing(route, r.id, U.third)).status).toBe(404)
    expect((await closing(route, 'not-a-uuid', U.cust)).status).toBe(404)
  }
  expect(await statusOf('requests', r.id)).toBe('open')
  const q = QuoteSchema.parse(await (await quote(r.id, U.owner)).json())
  expect((await confirming(q.id, U.cust)).status).toBe(200)
  for (const [route, as, code] of [[withdraw, U.cust, 'request-closed'], [decline, U.owner, 'request-closed-provider']] as const) {
    const res = await closing(route, r.id, as)
    expect([res.status, (await res.json()).error]).toEqual([409, code])
  }
  expect([await statusOf('requests', r.id), await statusOf('quotes', q.id)]).toEqual(['booked', 'accepted'])
})

it('withdraw racing sendQuote leaves no sent quote', async () => {
  const r = await newRequest()
  // hold the request's lock so both start waiting on it, then let them go together
  const holder = await pool.connect()
  let both: Promise<[Response, Response]>
  try {
    await holder.query('BEGIN')
    await holder.query("SELECT pg_advisory_xact_lock(hashtext('booking_request'), hashtext($1))", [r.id])
    both = Promise.all([closing(withdraw, r.id, U.cust), quote(r.id, U.owner)])
    await new Promise((ok) => setTimeout(ok, 500))
    await holder.query('COMMIT')
  } finally {
    holder.release()
  }
  const [w, s] = await both
  expect(w.status).toBe(200)
  expect(await statusOf('requests', r.id)).toBe('withdrawn')
  if (s.status === 201) expect(await statusOf('quotes', QuoteSchema.parse(await s.json()).id)).toBe('declined')
  else expect([s.status, (await s.json()).error]).toEqual([409, 'request-closed-provider'])
  expect((await pool.query("SELECT count(*)::int n FROM quotes WHERE request_id = $1 AND status = 'sent'", [r.id])).rows[0].n).toBe(0)
})

it('a request expiring between the read and the withdraw answers 409, not 500', async () => {
  const r = await newRequest()
  // the timers' expiry (which takes no request lock) is uncommitted when the withdraw reads 'open', committed before its UPDATE
  const holder = await pool.connect()
  let res: Promise<Response>
  try {
    await holder.query('BEGIN')
    await holder.query("UPDATE requests SET status = 'expired' WHERE id = $1", [r.id])
    res = closing(withdraw, r.id, U.cust)
    while (!(await pool.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query ILIKE 'update \"requests\"%'")).rowCount)
      await new Promise((ok) => setTimeout(ok, 10))
    await holder.query('COMMIT')
  } finally {
    holder.release()
  }
  const w = await res
  expect([w.status, (await w.json()).error]).toEqual([409, 'request-closed'])
  expect(await statusOf('requests', r.id)).toBe('expired')
})

it('the provider declining does not read the street of the customer, which is shown only after the customer confirms', async () => {
  await relaxLimits(U.cust)
  const made = await call(requests.POST, U.cust, 'POST', { providerId: pOwner, description: 'Secret street', ...requestTime(), address: { postcode: '10115', street: 'Geheimweg 7', city: 'Berlin' } })
  const r = RequestSchema.parse(await made.json())
  const res = await closing(decline, r.id, U.owner)
  expect(res.status).toBe(200)
  expect(JSON.stringify(await res.json())).not.toContain('Geheimweg')
})

it('a declined request stops the requests-ignored flag', async () => {
  const { runDueTimers } = await import('@kando/domain')
  const { db } = await import('@kando/db')
  const before = new Date(Date.now() - 15 * 86_400_000)
  for (const u of [U.quiet, U.silent]) await pool.query("INSERT INTO notifications (user_id, kind, payload, created_at) VALUES ($1, 'requests-ignored', '{}', $2)", [u, before])
  const r = await newRequest(pQuiet)
  expect((await closing(decline, r.id, U.quiet)).status).toBe(200) // the quiet provider answers by declining
  await runDueTimers(db, new Date())
  const flagged = async (p: string) => (await pool.query("SELECT count(*)::int n FROM staff_flags WHERE kind = 'ignored-requests' AND ref_id = $1", [p])).rows[0].n
  expect([await flagged(pQuiet), await flagged(pSilent)]).toEqual([0, 1])
})

it('GET /requests/{id} carries the thread id', async () => {
  const r = await newRequest()
  expect(r.threadId ?? null).toBeNull() // set by the read-one route only
  const threadId = (await pool.query('SELECT id FROM threads WHERE request_id = $1', [r.id])).rows[0].id
  for (const as of [U.cust, U.owner]) {
    const res = await call(requestOne.GET, as, 'GET', undefined, { id: r.id })
    expect(RequestSchema.parse(await res.json()).threadId).toBe(threadId)
  }
  expect((await call(requestOne.GET, U.third, 'GET', undefined, { id: r.id })).status).toBe(404)
})

it("a quote takes the currency of the provider's country", async () => {
  await pool.query("INSERT INTO currencies (code) VALUES ('ZAR') ON CONFLICT DO NOTHING")
  await pool.query("INSERT INTO countries (code, name_de, name_en, postcode_pattern, currency) VALUES ('ZZ', 'Zz', 'Zz', '^\\d+$', 'ZAR')")
  try {
    const r = await newRequest(pRemote)
    await pool.query("UPDATE providers SET country = 'ZZ' WHERE id = $1", [pRemote])
    const res = await quote(r.id, U.remote)
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    expect((await pool.query('SELECT currency FROM quotes WHERE id = $1', [id])).rows[0].currency).toBe('ZAR')
  } finally {
    await pool.query("UPDATE providers SET country = 'DE' WHERE id = $1", [pRemote])
    await pool.query("DELETE FROM countries WHERE code = 'ZZ'")
    await pool.query("DELETE FROM currencies WHERE code = 'ZAR'")
  }
})
