import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { db, pool } from '@kando/db'
import { runExpiryAndReminders } from '@kando/domain'
import { QuoteListSchema, QuoteSchema, RequestSchema } from '@kando/contract'
import { en } from '@kando/i18n'
import { setStorageForTests } from '@kando/domain/src/testing'
import { call, cleanupUsers, expireQuotes, memoryStorage, relaxLimits, requestTime, seedBase, seedProvider, seedUser } from './helpers'

// A booking that lapsed (payment time passed, or the time was never agreed) asks the customer if they still want it; "I don't need this
// anymore" is the customer's existing withdraw-request call (it expires a booking that only lapsed in the lists, declines the quote,
// closes the request and tells the provider).
vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const requests = await import('../app/app-api/v1/requests/route')
const oneRequest = await import('../app/app-api/v1/requests/[id]/route')
const quotes = await import('../app/app-api/v1/requests/[id]/quotes/route')
const withdraw = await import('../app/app-api/v1/requests/[id]/withdraw/route')
const confirm = await import('../app/app-api/v1/quotes/[id]/confirm/route')
const list = await import('../app/app-api/v1/quotes/route')

const U = { cust: 'lp-cust', stranger: 'lp-stranger', owner: 'lp-owner' }
let pOwner: string

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  for (const u of [U.cust, U.stranger]) await seedUser(u)
  pOwner = await seedProvider(U.owner, { name: 'Lp Owner', categoryId })
})
beforeEach(() => setStorageForTests(memoryStorage()))
afterEach(() => setStorageForTests(undefined))
afterAll(cleanupUsers)

let next = 20
const day = () => new Date(Date.now() + next++ * 86_400_000).toISOString()
const newRequest = async () => {
  await relaxLimits(U.cust)
  const res = await call(requests.POST, U.cust, 'POST', { providerId: pOwner, description: 'Fix the fence', ...requestTime(), startAt: day() })
  expect(res.status).toBe(201)
  return RequestSchema.parse(await res.json())
}
const sendQuote = async (r: { id: string; startAt: string | null; durationMin: number | null }, withTime: boolean) => {
  const res = await call(quotes.POST, U.owner, 'POST', { amount: 180, scope: 'Posts and panels', ...(withTime && { startAt: r.startAt, durationMin: r.durationMin }) }, { id: r.id })
  expect(res.status).toBe(201)
  return QuoteSchema.parse(await res.json())
}
const state = async (table: 'requests' | 'quotes' | 'bookings', id: string) => (await pool.query(`SELECT status FROM ${table} WHERE id = $1`, [id])).rows[0].status
const row = async (quoteId: string, as = U.cust) => QuoteListSchema.parse(await (await call(list.GET, as, 'GET')).json()).docs.find((d) => d.quoteId === quoteId)!
const request = async (id: string, as = U.cust) => RequestSchema.parse(await (await call(oneRequest.GET, as, 'GET', undefined, { id })).json())
const told = async (user: string, kind: string, requestId: string) => (await pool.query("SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND kind = $2 AND payload->>'requestId' = $3", [user, kind, requestId])).rows[0].n as number

/** A confirmed quote whose booking then lapsed, but the timer has not run: awaiting-payment past pay_by, or awaiting-time past answer_by. */
async function lapsedJob(kind: 'payment' | 'time') {
  const r = await newRequest()
  const q = await sendQuote(r, kind === 'payment')
  const res = await call(confirm.POST, U.cust, 'POST', {}, { id: q.id })
  expect(res.status).toBe(200)
  const b = (await res.json()) as { id: string; status: string }
  expect(b.status).toBe(kind === 'payment' ? 'awaiting-payment' : 'awaiting-time')
  await pool.query(kind === 'payment' ? "UPDATE bookings SET pay_by = now() - interval '1 day' WHERE id = $1" : "UPDATE bookings SET answer_by = now() - interval '1 day' WHERE id = $1", [b.id])
  return { r, q, b: b.id }
}

it.each(['payment', 'time'] as const)('a lapsed %s booking reads open again with its reason before the timer runs, and the same after it', async (kind) => {
  const x = await lapsedJob(kind)
  const open = await sendQuote(await newRequest(), true) // another request's ordinary quote: nothing lapsed
  expect(await state('bookings', x.b)).toMatch(/awaiting/) // not written yet
  expect(await row(x.q.id)).toMatchObject({ status: 'sent', lapsed: kind, bookingId: null })
  expect(await request(x.r.id)).toMatchObject({ status: 'quoted', lapsed: kind })
  expect(await row(open.id)).toMatchObject({ status: 'sent', lapsed: null })
  expect((await row(x.q.id, U.owner)).lapsed).toBeNull() // only the customer is asked

  await runExpiryAndReminders(db, new Date())
  expect(await state('bookings', x.b)).toBe('expired')
  expect(await row(x.q.id)).toMatchObject({ status: 'sent', lapsed: kind })
  expect(await request(x.r.id)).toMatchObject({ status: 'quoted', lapsed: kind })
  expect((await call(oneRequest.GET, U.stranger, 'GET', undefined, { id: x.r.id })).status).toBe(404)
})

it('a quote that lapsed and then expired is not asked about: there is nothing to book again', async () => {
  const x = await lapsedJob('payment')
  await expireQuotes('id = $1', [x.q.id])
  expect(await row(x.q.id)).toMatchObject({ status: 'expired', lapsed: null })
  expect((await request(x.r.id)).lapsed).toBeNull()
})

it.each(['payment', 'time'] as const)('"I don\'t need this anymore" closes a %s lapse that only lapsed in the lists: booking expired, quote declined, request withdrawn, the provider told once; another request is untouched', async (kind) => {
  const x = await lapsedJob(kind)
  const other = await newRequest()
  const otherQuote = await sendQuote(other, true)
  const res = await call(withdraw.POST, U.cust, 'POST', undefined, { id: x.r.id })
  expect(res.status).toBe(200)
  expect([await state('bookings', x.b), await state('quotes', x.q.id), await state('requests', x.r.id)]).toEqual(['expired', 'declined', 'withdrawn'])
  expect(await told(U.owner, 'request-withdrawn', x.r.id)).toBe(1)
  expect(await row(x.q.id)).toMatchObject({ status: 'declined', lapsed: null })
  expect(await request(x.r.id)).toMatchObject({ status: 'withdrawn', lapsed: null })
  expect([await state('quotes', otherQuote.id), await state('requests', other.id)]).toEqual(['sent', 'quoted'])
  expect(await told(U.owner, 'request-withdrawn', other.id)).toBe(0)
})

it('"I don\'t need this anymore" after the timer already expired the booking closes the job the same way', async () => {
  const x = await lapsedJob('payment')
  await runExpiryAndReminders(db, new Date())
  expect(await state('requests', x.r.id)).toBe('quoted')
  expect((await call(withdraw.POST, U.cust, 'POST', undefined, { id: x.r.id })).status).toBe(200)
  expect([await state('bookings', x.b), await state('quotes', x.q.id), await state('requests', x.r.id)]).toEqual(['expired', 'declined', 'withdrawn'])
  expect(await told(U.owner, 'request-withdrawn', x.r.id)).toBe(1)
})

it('a stranger cannot close the job (404, nothing changes) and nobody can close it twice (409 naming the next step)', async () => {
  const x = await lapsedJob('time')
  expect((await call(withdraw.POST, U.stranger, 'POST', undefined, { id: x.r.id })).status).toBe(404)
  expect(await state('requests', x.r.id)).toBe('booked') // still only lapsed in the lists
  expect((await call(withdraw.POST, U.cust, 'POST', undefined, { id: x.r.id })).status).toBe(200)
  const again = await call(withdraw.POST, U.cust, 'POST', undefined, { id: x.r.id })
  expect([again.status, (await again.json()).error]).toEqual([409, 'request-closed'])
  expect(en['error.booking.request-closed']).toMatch(/send a new request/) // the text names the action
  expect(await told(U.owner, 'request-withdrawn', x.r.id)).toBe(1) // told once
})
