import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { BookingSchema, QuoteSchema, RequestSchema } from '@kando/contract'
import { call, cleanupUsers, EMAIL, expireQuotes, seedBase, seedProvider, seedUser, relaxLimits } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const requests = await import('../app/app-api/v1/requests/route')
const requestOne = await import('../app/app-api/v1/requests/[id]/route')
const quotes = await import('../app/app-api/v1/requests/[id]/quotes/route')
const accept = await import('../app/app-api/v1/quotes/[id]/accept/route')
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
const proposal = (extra: object = {}) => ({ startAt: day(10), durationMin: 120, onSite: true, address: { postcode: '10115' }, ...extra })
const newRequest = async (providerId = pOwner, as = U.cust) => {
  await relaxLimits(as)
  return RequestSchema.parse(await (await call(requests.POST, as, 'POST', { providerId, description: 'Fix the fence' })).json())
}
const quote = (reqId: string, as: string, body: object = { amount: 100, scope: 'Fence' }) => call(quotes.POST, as, 'POST', body, { id: reqId })
const accepting = (quoteId: string, as: string, body: object = proposal()) => call(accept.POST, as, 'POST', body, { id: quoteId })
const ids = (j: { docs: { id: string }[] }) => j.docs.map((d) => d.id)

it('customer creates a request; provider sees it incoming', async () => {
  const res = await call(requests.POST, U.cust, 'POST', { providerId: pOwner, description: 'Fix the fence', preferredDate: '2027-01-05' })
  expect(res.status).toBe(201)
  const r = RequestSchema.parse(await res.json())
  expect(r).toMatchObject({ customerId: U.cust, providerId: pOwner, status: 'open', preferredDate: '2027-01-05' })
  expect(new Date(r.answerBy).getTime() - new Date(r.createdAt).getTime()).toBe(3 * 86_400_000)
  const asProvider = await requests.GET(
    new Request('http://localhost/app-api/v1/requests?role=provider', { headers: { cookie: `uid=${U.owner}:${EMAIL(U.owner)}` } }),
    { params: Promise.resolve({}) },
  )
  expect(ids(await asProvider.json())).toContain(r.id)
  expect(ids(await (await call(requests.GET, U.owner)).json())).not.toContain(r.id) // as a customer the owner has none
  expect(ids(await (await call(requests.GET, U.cust)).json())).toContain(r.id)
})

it('request to an unpublished or suspended provider is 404', async () => {
  for (const providerId of [pDraft, pSusp, crypto.randomUUID()]) {
    expect((await call(requests.POST, U.cust, 'POST', { providerId, description: 'x' })).status).toBe(404)
  }
})

it('own service request is 400', async () => {
  expect((await call(requests.POST, U.owner, 'POST', { providerId: pOwner, description: 'x' })).status).toBe(400)
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
  expect((await accepting(q1.id, U.cust)).status).toBe(409) // the superseded quote can no longer be accepted
})

it('customer accepts the quote with a time proposal and gets a proposed booking (no payBy yet)', async () => {
  const r = await newRequest()
  const q = QuoteSchema.parse(await (await quote(r.id, U.owner, { amount: 99.5, scope: 'Fence' })).json())
  const res = await accepting(q.id, U.cust, { ...proposal(), note: 'Gate code 1234', amount: 1 }) // a client amount is ignored
  expect(res.status).toBe(200)
  const b = BookingSchema.parse(await res.json())
  expect(b).toMatchObject({ status: 'proposed', source: 'quote', quoteId: q.id, customerId: U.cust, providerId: pOwner, amount: 99.5, currency: 'EUR', onSite: true, payBy: null, note: 'Gate code 1234', address: { postcode: '10115' } })
  expect(new Date(b.answerBy!).getTime() - new Date(b.createdAt).getTime()).toBe(24 * 3_600_000)
  const st = (await pool.query('SELECT (SELECT status FROM quotes WHERE id = $1) q, (SELECT status FROM requests WHERE id = $2) r', [q.id, r.id])).rows[0]
  expect(st).toEqual({ q: 'accepted', r: 'booked' })
})

it("a quote's suggested time can be kept or replaced by the customer", async () => {
  const suggested = day(20)
  const withSuggestion = async () => {
    const r = await newRequest()
    return QuoteSchema.parse(await (await quote(r.id, U.owner, { amount: 50, scope: 's', startAt: suggested, durationMin: 60 })).json())
  }
  const q = await withSuggestion()
  expect(q).toMatchObject({ startAt: suggested, durationMin: 60 })
  const kept = BookingSchema.parse(await (await accepting(q.id, U.cust, proposal({ startAt: suggested, durationMin: 60 }))).json())
  expect(kept.startAt).toBe(suggested)
  const q2 = await withSuggestion()
  const other = day(25)
  const replaced = BookingSchema.parse(await (await accepting(q2.id, U.cust, proposal({ startAt: other, durationMin: 90 }))).json())
  expect([replaced.startAt, replaced.durationMin]).toEqual([other, 90])
})

it('onSite false is refused when the provider does not work remotely', async () => {
  const r = await newRequest()
  const q = QuoteSchema.parse(await (await quote(r.id, U.owner)).json())
  expect((await accepting(q.id, U.cust, { startAt: day(10), durationMin: 60, onSite: false })).status).toBe(400)
  const rr = await newRequest(pRemote)
  const qr = QuoteSchema.parse(await (await quote(rr.id, U.remote)).json())
  const ok = await accepting(qr.id, U.cust, { startAt: day(10), durationMin: 60, onSite: false })
  expect(ok.status).toBe(200)
  expect(BookingSchema.parse(await ok.json())).toMatchObject({ onSite: false, address: null })
})

it('past times, absurd durations and an address-less on-site proposal are 400', async () => {
  const r = await newRequest()
  const q = QuoteSchema.parse(await (await quote(r.id, U.owner)).json())
  for (const bad of [{ startAt: day(-1) }, { startAt: day(400) }, { durationMin: 5000 }, { address: undefined }]) {
    expect((await accepting(q.id, U.cust, proposal(bad))).status).toBe(400)
  }
  expect((await quote(r.id, U.owner, { amount: 10, scope: 's', startAt: day(-1) })).status).toBe(400)
  expect((await quote(r.id, U.owner, { amount: -5, scope: 's' })).status).toBe(400)
})

it('accepting an expired quote is 409', async () => {
  const r = await newRequest()
  const q = QuoteSchema.parse(await (await quote(r.id, U.owner)).json())
  await expireQuotes('id = $1', [q.id])
  expect((await accepting(q.id, U.cust)).status).toBe(409)
})

it('two concurrent accepts: one 200, one 409', async () => {
  const r = await newRequest()
  const q = QuoteSchema.parse(await (await quote(r.id, U.owner)).json())
  // hold the request's advisory lock: both accepts must wait for it (proves they take it), then exactly one wins
  const holder = await pool.connect()
  let both: Promise<Response[]>
  try {
    await holder.query('BEGIN')
    await holder.query("SELECT pg_advisory_xact_lock(hashtext('booking_request'), hashtext($1))", [r.id])
    both = Promise.all([accepting(q.id, U.cust), accepting(q.id, U.cust)])
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

it('a third user gets 404 on every route; the provider cannot accept', async () => {
  const r = await newRequest()
  const q = QuoteSchema.parse(await (await quote(r.id, U.owner)).json())
  expect((await call(requestOne.GET, U.third, 'GET', undefined, { id: r.id })).status).toBe(404)
  expect((await call(quotes.GET, U.third, 'GET', undefined, { id: r.id })).status).toBe(404)
  expect((await quote(r.id, U.third)).status).toBe(404)
  expect((await accepting(q.id, U.third)).status).toBe(404)
  expect((await accepting(q.id, U.owner)).status).toBe(404)
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
  expect((await accepting(q.id, U.cust)).status).toBe(200)
  expect((await quote(r.id, U.owner)).status).toBe(409)
})

it('a provider suspended or unpublished after the request cannot quote, and the quote cannot be accepted', async () => {
  const gone = async (change: string) => {
    const r = await newRequest(pRemote)
    const q = QuoteSchema.parse(await (await quote(r.id, U.remote)).json())
    const r2 = await newRequest(pRemote, U.third) // another customer: one open request per pair
    await pool.query(change)
    const out = [(await quote(r2.id, U.remote)).status, (await accepting(q.id, U.cust)).status]
    await pool.query("UPDATE providers SET status = 'published', suspended_until = NULL WHERE id = $1", [pRemote])
    return out
  }
  expect(await gone(`UPDATE providers SET suspended_until = now() + interval '1 day' WHERE id = '${pRemote}'`)).toEqual([409, 409])
  expect(await gone(`UPDATE providers SET status = 'draft' WHERE id = '${pRemote}'`)).toEqual([409, 409])
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
  expect((await accepting(q.id, U.cust)).status).toBe(409) // nothing left to accept
  expect((await quote(quoted.id, U.owner)).status).toBe(409) // nor to quote
})

it('the provider declines; the customer is told; the request leaves the pair limit', async () => {
  const r = await newRequest()
  expect((await call(requests.POST, U.cust, 'POST', { providerId: pOwner, description: 'Again' })).status).toBe(409) // one live request per pair
  const res = await closing(decline, r.id, U.owner)
  expect(res.status).toBe(200)
  expect(RequestSchema.parse(await res.json())).toMatchObject({ id: r.id, status: 'declined' })
  expect(await told(U.cust, 'request-declined', r.id)).toBe(1)
  expect((await call(requests.POST, U.cust, 'POST', { providerId: pOwner, description: 'Again' })).status).toBe(201)
})

it('the other side gets 403, a stranger 404, a booked request 409', async () => {
  const r = await newRequest()
  for (const [route, wrong] of [[withdraw, U.owner], [decline, U.cust]] as const) {
    const res = await closing(route, r.id, wrong)
    expect([res.status, (await res.json()).error]).toEqual([403, 'not-your-turn'])
    expect((await closing(route, r.id, U.third)).status).toBe(404)
    expect((await closing(route, 'not-a-uuid', U.cust)).status).toBe(404)
  }
  expect(await statusOf('requests', r.id)).toBe('open')
  const q = QuoteSchema.parse(await (await quote(r.id, U.owner)).json())
  expect((await accepting(q.id, U.cust)).status).toBe(200)
  for (const [route, as] of [[withdraw, U.cust], [decline, U.owner]] as const) {
    const res = await closing(route, r.id, as)
    expect([res.status, (await res.json()).error]).toEqual([409, 'request-closed'])
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
  else expect([s.status, (await s.json()).error]).toEqual([409, 'request-closed'])
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
  await pool.query("INSERT INTO currencies (code, minor_units) VALUES ('ZAR', 2) ON CONFLICT DO NOTHING")
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
