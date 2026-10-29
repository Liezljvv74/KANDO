import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { BookingSchema, QuoteSchema, RequestSchema } from '@kando/contract'
import { call, cleanupUsers, EMAIL, seedBase, seedProvider, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const requests = await import('../app/app-api/v1/requests/route')
const requestOne = await import('../app/app-api/v1/requests/[id]/route')
const quotes = await import('../app/app-api/v1/requests/[id]/quotes/route')
const accept = await import('../app/app-api/v1/quotes/[id]/accept/route')

const U = { cust: 'rq-cust', owner: 'rq-owner', remote: 'rq-remote', susp: 'rq-susp', draft: 'rq-draft', third: 'rq-third' }
let pOwner: string, pRemote: string, pSusp: string, pDraft: string

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  for (const u of [U.cust, U.third]) await seedUser(u)
  pOwner = await seedProvider(U.owner, { name: 'Rq Owner', categoryId })
  pRemote = await seedProvider(U.remote, { name: 'Rq Remote', categoryId, remote: true })
  pSusp = await seedProvider(U.susp, { name: 'Rq Susp', categoryId, suspended: true })
  pDraft = await seedProvider(U.draft, { name: 'Rq Draft', categoryId, status: 'draft' })
})
afterAll(cleanupUsers)

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()
const proposal = (extra: object = {}) => ({ startAt: day(10), durationMin: 120, onSite: true, address: { postcode: '10115' }, ...extra })
const newRequest = async (providerId = pOwner, as = U.cust) =>
  RequestSchema.parse(await (await call(requests.POST, as, 'POST', { providerId, description: 'Fix the fence' })).json())
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
  await pool.query("UPDATE quotes SET expires_at = now() - interval '1 minute' WHERE id = $1", [q.id])
  expect((await accepting(q.id, U.cust)).status).toBe(409)
})

it('two concurrent accepts: one 200, one 409', async () => {
  const r = await newRequest()
  const q = QuoteSchema.parse(await (await quote(r.id, U.owner)).json())
  // hold the request's advisory lock: both accepts must wait for it (proves they take it), then exactly one wins
  const holder = await pool.connect()
  await holder.query('BEGIN')
  await holder.query("SELECT pg_advisory_xact_lock(hashtext('booking_request'), hashtext($1))", [r.id])
  const both = Promise.all([accepting(q.id, U.cust), accepting(q.id, U.cust)])
  await new Promise((ok) => setTimeout(ok, 500))
  expect((await pool.query('SELECT count(*)::int n FROM bookings WHERE quote_id = $1', [q.id])).rows[0].n).toBe(0)
  await holder.query('COMMIT')
  holder.release()
  const res = await both
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
