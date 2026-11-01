import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { BookingSchema, QuoteSchema, RequestSchema } from '@kando/contract'
import { call, cleanupUsers, expireQuotes, relaxLimits, requestTime, seedBase, seedProvider, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const requests = await import('../app/app-api/v1/requests/route')
const quotes = await import('../app/app-api/v1/requests/[id]/quotes/route')
const revise = await import('../app/app-api/v1/requests/[id]/revise/route')
const confirm = await import('../app/app-api/v1/quotes/[id]/confirm/route')

const U = { cust: 'qc-cust', cust2: 'qc-cust2', owner: 'qc-owner', third: 'qc-third' }
let pOwner: string

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  for (const u of [U.cust, U.cust2, U.third]) await seedUser(u)
  pOwner = await seedProvider(U.owner, { name: 'Qc Owner', categoryId })
})
afterAll(cleanupUsers)

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()
// every test needs its own day: a confirmed booking holds the provider's time, so equal times would clash
let next = 100
const fresh = () => ({ ...requestTime(), startAt: day(next++) })
const newRequest = async (as = U.cust, time: object = fresh()) => {
  await relaxLimits(as)
  return RequestSchema.parse(await (await call(requests.POST, as, 'POST', { providerId: pOwner, description: 'Fix the fence', ...time })).json())
}
/** A request and the provider's quote for the request's own time (or without a time). */
const quoted = async (as = U.cust, time: object = fresh(), withTime = true) => {
  const r = await newRequest(as, time)
  const body = withTime ? { amount: 150, scope: 'Fence', startAt: r.startAt, durationMin: r.durationMin } : { amount: 150, scope: 'Fence' }
  const q = QuoteSchema.parse(await (await call(quotes.POST, U.owner, 'POST', body, { id: r.id })).json())
  return { r, q }
}
const confirming = (quoteId: string, as = U.cust, body: object = {}) => call(confirm.POST, as, 'POST', body, { id: quoteId })
const state = async (table: 'requests' | 'quotes', id: string) => (await pool.query(`SELECT status FROM ${table} WHERE id = $1`, [id])).rows[0].status
const notices = async (user: string, kind: string) => (await pool.query('SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND kind = $2', [user, kind])).rows[0].n

it('confirming a quote with a time makes a booking that awaits payment, at the quote\'s price and time', async () => {
  const { r, q } = await quoted()
  const before = await notices(U.owner, 'quote-confirmed')
  const res = await confirming(q.id, U.cust, { note: 'Thank you' })
  expect(res.status).toBe(200)
  const b = BookingSchema.parse(await res.json())
  expect(b).toMatchObject({ status: 'awaiting-payment', source: 'quote', amount: 150, durationMin: r.durationMin, note: 'Thank you', quoteId: q.id, requestId: r.id })
  expect(new Date(b.startAt).getTime()).toBe(new Date(q.startAt!).getTime())
  expect(b.payBy).not.toBeNull()
  expect(b.address).toEqual({ postcode: '10115' }) // the customer reads the whole place back
  expect([await state('quotes', q.id), await state('requests', r.id)]).toEqual(['accepted', 'booked'])
  expect(await notices(U.owner, 'quote-confirmed')).toBe(before + 1)
  const card = (await pool.query("SELECT card FROM messages m JOIN threads t ON t.id = m.thread_id WHERE t.request_id = $1 AND m.kind = 'card' ORDER BY m.created_at DESC LIMIT 1", [r.id])).rows[0]?.card
  expect(card).toMatchObject({ type: 'acceptance', refId: b.id })
})

it('the same quote cannot be confirmed twice', async () => {
  const { q } = await quoted()
  expect((await confirming(q.id)).status).toBe(200)
  const again = await confirming(q.id)
  expect([again.status, (await again.json()).error]).toEqual([409, 'quote-not-open'])
})

it('two customers confirming overlapping times: the first gets the slot, the second a plain 409', async () => {
  const when = fresh()
  const a = await quoted(U.cust, when)
  const b = await quoted(U.cust2, when)
  expect((await confirming(a.q.id, U.cust)).status).toBe(200)
  const second = await confirming(b.q.id, U.cust2)
  expect([second.status, (await second.json()).error]).toEqual([409, 'slot-pending'])
  expect(await state('quotes', b.q.id)).toBe('sent') // nothing half-written: the quote is still open for another time
})

it('an expired quote and a quote replaced by the provider\'s revised quote cannot be confirmed', async () => {
  const old = await quoted()
  await expireQuotes('request_id = $1', [old.r.id])
  const e = await confirming(old.q.id)
  expect([e.status, (await e.json()).error]).toEqual([409, 'quote-expired'])
  const replaced = await quoted()
  expect((await call(revise.POST, U.cust, 'POST', { ...requestTime(), startAt: day(next++) }, { id: replaced.r.id })).status).toBe(409) // the customer cannot change a quoted request
  expect((await call(quotes.POST, U.owner, 'POST', { amount: 160, scope: 'Fence, revised' }, { id: replaced.r.id })).status).toBe(201)
  const s = await confirming(replaced.q.id)
  expect([s.status, (await s.json()).error]).toEqual([409, 'quote-not-open'])
})

it('a stranger gets 404, the provider 403, and a body with a time is refused', async () => {
  const { q } = await quoted()
  expect((await confirming(q.id, U.third)).status).toBe(404)
  expect((await confirming(q.id, U.owner)).status).toBe(403)
  expect((await confirming(q.id, U.cust, { ...requestTime() })).status).toBe(400)
  expect((await confirming(q.id)).status).toBe(200) // none of the refusals used it up
})

it('a quote without a time becomes a booking that waits for its time: no slot, no payment window', async () => {
  const when = fresh()
  const { r, q } = await quoted(U.cust, when, false)
  const res = await confirming(q.id)
  expect(res.status).toBe(200)
  const b = BookingSchema.parse(await res.json())
  expect(b).toMatchObject({ status: 'awaiting-time', payBy: null, amount: 150 })
  expect(new Date(b.startAt).getTime()).toBe(new Date(r.startAt!).getTime()) // the customer's requested time stands in until both agree
  const waits = (await pool.query('SELECT answer_by FROM bookings WHERE id = $1', [b.id])).rows[0].answer_by as Date
  expect(Math.abs(waits.getTime() - (Date.now() + 7 * 86_400_000))).toBeLessThan(60_000)
  const busy = (await pool.query("SELECT * FROM busy_times($1::uuid, $2::timestamptz, $3::timestamptz)", [pOwner, new Date(new Date(r.startAt!).getTime() - 3_600_000), new Date(new Date(r.startAt!).getTime() + 4 * 3_600_000)])).rows
  expect(busy).toEqual([])
  expect([await state('quotes', q.id), await state('requests', r.id)]).toEqual(['accepted', 'booked'])
  // another customer can still get that very time, because the waiting booking holds nothing
  const other = await quoted(U.cust2, when)
  expect((await confirming(other.q.id, U.cust2)).status).toBe(200)
})
