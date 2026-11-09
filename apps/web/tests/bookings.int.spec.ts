import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { BookingSchema, BookingViewSchema, QuoteSchema, RequestSchema } from '@kando/contract'
import { requestTime, call, cleanupUsers, makeAwaitingPayment, seedBase, seedBooking, seedProvider, seedUser, relaxLimits } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const bookingOne = await import('../app/app-api/v1/bookings/[id]/route')
const withdraw = await import('../app/app-api/v1/bookings/[id]/withdraw/route')
const requests = await import('../app/app-api/v1/requests/route')
const quotes = await import('../app/app-api/v1/requests/[id]/quotes/route')
const confirm = await import('../app/app-api/v1/quotes/[id]/confirm/route')

const U = { cust: 'bk-cust', cust2: 'bk-cust2', owner: 'bk-owner', third: 'bk-third', pager: 'bk-pager' }
let pOwner: string


beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  for (const u of [U.cust, U.cust2, U.third, U.pager]) await seedUser(u)
  pOwner = await seedProvider(U.owner, { name: 'Bk Owner', categoryId })
})
afterAll(cleanupUsers)

const day = (n: number, h = 0) => new Date(Date.now() + n * 86_400_000 + h * 3_600_000).toISOString()
let nextDay = 100 // every booking gets its own day, so they never collide by accident
/** A booking awaiting payment, made through the one request flow (request, quote, confirm). */
const made = (startAt = day(nextDay++), as = U.cust, extra: object = {}) => makeAwaitingPayment({ customerId: as, ownerId: U.owner, providerId: pOwner, startAt, ...extra })
/** A booking that waits for its time (a quote without a time): no pay_by yet, so the provider does not see the address. */
const waiting = async (as = U.cust) => {
  await relaxLimits(as)
  const r = RequestSchema.parse(await (await call(requests.POST, as, 'POST', { providerId: pOwner, description: 'Fix', ...requestTime(), startAt: day(nextDay++) })).json())
  const q = QuoteSchema.parse(await (await call(quotes.POST, U.owner, 'POST', { amount: 100, scope: 'Fence' }, { id: r.id })).json())
  return BookingSchema.parse(await (await call(confirm.POST, as, 'POST', {}, { id: q.id })).json())
}
const withdrawing = (id: string, as: string) => call(withdraw.POST, as, 'POST', undefined, { id })
const row = async (id: string) => (await pool.query('SELECT status, pay_by, answer_by, start_at, on_site, accepted_at FROM bookings WHERE id = $1', [id])).rows[0]
const seen = async (uid: string, id: string) => {
  const res = await call(bookingOne.GET, uid, 'GET', undefined, { id })
  return res.status === 200 ? BookingViewSchema.parse(await res.json()).booking : null
}

it('a booking from the request flow: amount from the quote, payBy set, listed for both parties and not for a stranger', async () => {
  const b = await made(day(nextDay++), U.cust, { amount: 120 })
  expect(b).toMatchObject({ status: 'awaiting-payment', customerId: U.cust, providerId: pOwner, amount: 120, currency: 'EUR', onSite: true, answerBy: null, address: { postcode: '10115' } })
  expect(b.payBy).not.toBeNull()
  expect((await seen(U.cust, b.id))?.id).toBe(b.id)
  expect((await seen(U.owner, b.id))?.id).toBe(b.id)
  expect(await seen(U.third, b.id)).toBeNull()
})

it('job address is hidden from the provider until the booking has a payment deadline', async () => {
  const b = await waiting()
  expect((await seen(U.owner, b.id))!.address).toBeNull()
  expect((await seen(U.cust, b.id))!.address).toMatchObject({ postcode: '10115' })
  const paying = await made()
  expect((await seen(U.owner, paying.id))!.address).toMatchObject({ postcode: '10115' })
})

it('customer withdraws an awaiting-payment booking and the slot is free again', async () => {
  const first = await made(day(30))
  await expect(made(day(30, 1), U.cust2)).rejects.toThrow('409') // overlaps the first
  expect((await withdrawing(first.id, U.owner)).status).toBe(403) // the provider cannot "withdraw"
  expect((await withdrawing(first.id, U.third)).status).toBe(404)
  const w = await withdrawing(first.id, U.cust)
  expect(w.status).toBe(200)
  expect(BookingSchema.parse(await w.json()).status).toBe('withdrawn')
  expect((await made(day(30, 1), U.cust2)).status).toBe('awaiting-payment')
  expect((await withdrawing(first.id, U.cust)).status).toBe(409) // already withdrawn
})

it('a lapsed payment window no longer holds the slot before any sweep runs', async () => {
  const base = day(95)
  const held = await made(base)
  await pool.query("UPDATE bookings SET pay_by = now() - interval '1 hour' WHERE id = $1", [held.id])
  expect((await made(base, U.cust2)).status).toBe('awaiting-payment')
})

const statusOf = async (table: 'requests' | 'quotes', id: string) => (await pool.query(`SELECT status FROM ${table} WHERE id = $1`, [id])).rows[0].status as string
const noticesOf = async (bookingId: string, uid = U.cust) => (await pool.query("SELECT user_id, kind, payload FROM notifications WHERE payload->>'bookingId' = $1 AND user_id = $2 ORDER BY kind", [bookingId, uid])).rows

const provAddr = async (id: string) => (await seen(U.owner, id))!.address

it('the provider never sees the address of a booking that never had a payment deadline; one that had stays visible after withdrawal', async () => {
  const withdrawn = await waiting()
  await withdrawing(withdrawn.id, U.cust)
  expect(await provAddr(withdrawn.id)).toBeNull()
  const accepted = await made()
  await withdrawing(accepted.id, U.cust)
  expect(await provAddr(accepted.id)).toMatchObject({ postcode: '10115' })
  expect((await seen(U.cust, withdrawn.id))!.address).toMatchObject({ postcode: '10115' })
})

it('the customer withdraws a quote-born booking: the whole job is closed (booking and request withdrawn, quote not open), the provider is told once, the job is Past', async () => {
  const b = await made()
  const [requestId, quoteId] = [b.requestId!, b.quoteId!]
  expect([await statusOf('requests', requestId), await statusOf('quotes', quoteId)]).toEqual(['booked', 'accepted'])
  await pool.query('DELETE FROM notifications WHERE user_id = ANY($1)', [[U.cust, U.owner]])
  expect((await withdrawing(b.id, U.cust)).status).toBe(200)
  expect(await statusOf('requests', requestId)).toBe('withdrawn')
  expect(await statusOf('quotes', quoteId)).toBe('declined')
  expect((await row(b.id)).status).toBe('withdrawn')
  expect(await noticesOf(b.id)).toEqual([])
  const told = (await pool.query("SELECT kind FROM notifications WHERE user_id = $1 AND payload->>'requestId' = $2", [U.owner, requestId])).rows
  expect(told).toEqual([{ kind: 'request-withdrawn' }])
  expect((await seen(U.cust, b.id))!.jobState).toMatchObject({ key: 'declined_expired', section: 'past' })
  expect((await withdrawing(b.id, U.cust)).status).toBe(409)
})

it('withdrawing an additional task leaves the root job alone', async () => {
  const root = await made()
  await pool.query("UPDATE bookings SET status = 'completed' WHERE id = $1", [root.id])
  const kid = await seedBooking({ customerId: root.customerId, providerId: root.providerId, amount: 5, cols: { service_id: root.serviceId, status: 'awaiting-payment', start_at: new Date(root.startAt), parent_booking_id: root.id, pay_by: new Date(Date.now() + 86_400_000), accepted_at: new Date() } })
  expect((await withdrawing(kid, U.cust)).status).toBe(200)
  expect((await row(kid)).status).toBe('withdrawn')
  expect((await row(root.id)).status).toBe('completed')
  expect(await statusOf('requests', root.requestId!)).toBe('booked')
})

it('GET /bookings/{id} answers each party with viewer and threadId, a stranger 404, and writes nothing', async () => {
  const b = await made()
  const threadId = (await pool.query('SELECT id FROM threads WHERE request_id = $1', [b.requestId])).rows[0].id
  const one = async (as: string, id = b.id) => {
    const res = await call(bookingOne.GET, as, 'GET', undefined, { id })
    return { status: res.status, body: res.status === 200 ? BookingViewSchema.parse(await res.json()) : null }
  }
  expect((await one(U.cust)).body).toMatchObject({ viewer: 'customer', threadId, booking: { id: b.id, address: { postcode: '10115' } } })
  expect((await one(U.owner)).body).toMatchObject({ viewer: 'provider', threadId, booking: { id: b.id, address: { postcode: '10115' } } })
  expect((await one(U.third)).status).toBe(404)
  expect((await one(U.cust, 'not-a-uuid')).status).toBe(404)
  // an additional task talks in its root's thread
  await pool.query("UPDATE bookings SET status = 'completed' WHERE id = $1", [b.id])
  const kid = await seedBooking({ customerId: b.customerId, providerId: b.providerId, amount: 5, cols: { service_id: b.serviceId, status: 'declined', start_at: new Date(b.startAt), parent_booking_id: b.id } })
  expect((await one(U.owner, kid)).body).toMatchObject({ viewer: 'provider', threadId, booking: { parentBookingId: b.id } })
  // no writes: an unpaid booking past its deadline reads expired but stays awaiting-payment in the row, and a missing thread is not created
  const late = await made()
  await pool.query("UPDATE bookings SET pay_by = now() - interval '1 hour' WHERE id = $1", [late.id])
  await pool.query('DELETE FROM threads WHERE request_id = $1', [late.requestId])
  expect((await one(U.cust, late.id)).body).toMatchObject({ viewer: 'customer', threadId: null, booking: { status: 'expired' } })
  expect((await row(late.id)).status).toBe('awaiting-payment')
  expect((await pool.query('SELECT count(*)::int AS n FROM threads WHERE request_id = $1', [late.requestId])).rows[0].n).toBe(0)
})
