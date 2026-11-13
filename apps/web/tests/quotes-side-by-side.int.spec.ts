import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { db, pool } from '@kando/db'
import { runExpiryAndReminders } from '@kando/domain'
import { BookingViewSchema, QuoteListSchema, QuoteSchema, RequestSchema } from '@kando/contract'
import { setStorageForTests } from '@kando/domain/src/testing'
import { call, cleanupUsers, memoryStorage, requestTime, relaxLimits, seedBase, seedProvider, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const requests = await import('../app/app-api/v1/requests/route')
const quotes = await import('../app/app-api/v1/requests/[id]/quotes/route')
const confirm = await import('../app/app-api/v1/quotes/[id]/confirm/route')
const list = await import('../app/app-api/v1/quotes/route')
const bookingRoute = await import('../app/app-api/v1/bookings/[id]/route')

const U = { cust: 'sb-cust', other: 'sb-other', owner: 'sb-owner', owner2: 'sb-owner2' }
let pOwner: string, pOwner2: string, serviceOwner: string

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  for (const u of [U.cust, U.other]) await seedUser(u)
  pOwner = await seedProvider(U.owner, { name: 'Sb Owner', categoryId })
  pOwner2 = await seedProvider(U.owner2, { name: 'Sb Owner2', categoryId })
  serviceOwner = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [pOwner])).rows[0].id
})
beforeEach(() => setStorageForTests(memoryStorage()))
afterEach(() => setStorageForTests(undefined))
afterAll(cleanupUsers)

// every request gets its own day: a confirmed booking holds the provider's time, so equal times would clash
let next = 20
const day = () => new Date(Date.now() + next++ * 86_400_000).toISOString()
const newRequest = async (providerId = pOwner, as = U.cust, extra: object = {}) => {
  const res = await call(requests.POST, as, 'POST', { providerId, description: 'Fix the fence', ...requestTime(), startAt: day(), ...extra })
  expect(res.status).toBe(201)
  return RequestSchema.parse(await res.json())
}
const sendQuote = async (owner: string, r: { id: string; startAt: string | null; durationMin: number | null }, amount: number) => {
  const res = await call(quotes.POST, owner, 'POST', { amount, scope: `Scope ${amount}`, startAt: r.startAt, durationMin: r.durationMin }, { id: r.id })
  expect(res.status).toBe(201)
  return QuoteSchema.parse(await res.json())
}
const confirming = (quoteId: string, as = U.cust) => call(confirm.POST, as, 'POST', {}, { id: quoteId })
const state = async (table: 'requests' | 'quotes', id: string) => (await pool.query(`SELECT status FROM ${table} WHERE id = $1`, [id])).rows[0].status
const listing = async (as: string) => QuoteListSchema.parse(await (await call(list.GET, as, 'GET')).json()).docs

it('two requests to one provider are quoted side by side; confirming one leaves the other untouched, and both can be confirmed', async () => {
  const r1 = await newRequest()
  const r2 = await newRequest()
  const q1 = await sendQuote(U.owner, r1, 100)
  const q2 = await sendQuote(U.owner, r2, 250)
  expect([q1.status, q2.status]).toEqual(['sent', 'sent'])
  expect(new Date(q1.expiresAt).getTime()).toBeGreaterThan(Date.now())

  const res = await confirming(q2.id)
  expect(res.status).toBe(200)
  const b2 = await res.json()
  expect(b2).toMatchObject({ quoteId: q2.id, requestId: r2.id, amount: 250 })
  expect([await state('quotes', q2.id), await state('requests', r2.id)]).toEqual(['accepted', 'booked'])
  expect([await state('quotes', q1.id), await state('requests', r1.id)]).toEqual(['sent', 'quoted']) // untouched

  const res1 = await confirming(q1.id)
  expect(res1.status).toBe(200)
  expect(await res1.json()).toMatchObject({ quoteId: q1.id, requestId: r1.id, amount: 100 })
  expect([await state('quotes', q1.id), await state('quotes', q2.id)]).toEqual(['accepted', 'accepted'])
  expect((await pool.query('SELECT count(*)::int n FROM bookings WHERE customer_id = $1', [U.cust])).rows[0].n).toBeGreaterThanOrEqual(2)
})

it('declining or withdrawing one request does not touch the quote of the other', async () => {
  const r1 = await newRequest()
  const r2 = await newRequest()
  const q1 = await sendQuote(U.owner, r1, 90)
  const q2 = await sendQuote(U.owner, r2, 95)
  const withdraw = await import('../app/app-api/v1/requests/[id]/withdraw/route')
  expect((await call(withdraw.POST, U.cust, 'POST', undefined, { id: r1.id })).status).toBe(200)
  expect([await state('quotes', q1.id), await state('quotes', q2.id)]).toEqual(['declined', 'sent'])
  expect(await state('requests', r2.id)).toBe('quoted')
  expect((await confirming(q2.id)).status).toBe(200)
})

it('a revised quote supersedes only the older version of its own request, not another request\'s quote', async () => {
  const r1 = await newRequest()
  const r2 = await newRequest()
  const q1 = await sendQuote(U.owner, r1, 100)
  const q2 = await sendQuote(U.owner, r2, 200)
  const q1v2 = await sendQuote(U.owner, r1, 120)
  expect(q1v2.version).toBe(2)
  expect([await state('quotes', q1.id), await state('quotes', q1v2.id), await state('quotes', q2.id)]).toEqual(['superseded', 'sent', 'sent'])
  const [old] = (await pool.query('SELECT status FROM quotes WHERE request_id = $1 AND version = 1', [r2.id])).rows
  expect(old.status).toBe('sent')
  expect((await confirming(q2.id)).status).toBe(200) // the other request's quote is still valid
})

it('quotes of different providers to the same customer are independent', async () => {
  const a = await newRequest(pOwner)
  const b = await newRequest(pOwner2)
  const qa = await sendQuote(U.owner, a, 70)
  const qb = await sendQuote(U.owner2, b, 80)
  expect((await confirming(qa.id)).status).toBe(200)
  expect(await state('quotes', qb.id)).toBe('sent')
  expect(await state('requests', b.id)).toBe('quoted')
  expect((await confirming(qb.id)).status).toBe(200)
})

it('the quote list shows the category name for a service with an empty title', async () => {
  const cat = (await pool.query('SELECT category_id FROM services WHERE id = $1', [serviceOwner])).rows[0].category_id as string
  await pool.query("INSERT INTO category_texts (category_id, lang, name) VALUES ($1, 'de', 'Kategorie DE'), ($1, 'en', 'Category EN') ON CONFLICT DO NOTHING", [cat])
  await pool.query("UPDATE services SET title = '' WHERE id = $1", [serviceOwner])
  const r = await newRequest(pOwner, U.other, { serviceId: serviceOwner })
  const q = await sendQuote(U.owner, r, 333)
  const item = (await listing(U.other)).find((d) => d.quoteId === q.id)!
  await pool.query("UPDATE services SET title = 'Sb Owner service' WHERE id = $1", [serviceOwner])
  expect(['Kategorie DE', 'Category EN']).toContain(item.service)
})

it('the quote list carries service, scope, expiry, and for an accepted quote the booking and when it was made', async () => {
  const r1 = await newRequest(pOwner, U.other, { serviceId: serviceOwner })
  const r2 = await newRequest(pOwner, U.other)
  const q1 = await sendQuote(U.owner, r1, 111)
  const q2 = await sendQuote(U.owner, r2, 222)
  const b1 = await (await confirming(q1.id, U.other)).json()

  const mine = await listing(U.other)
  const a = mine.find((d) => d.quoteId === q1.id)!
  const o = mine.find((d) => d.quoteId === q2.id)!
  expect(a).toMatchObject({ role: 'customer', status: 'accepted', service: 'Sb Owner service', scope: 'Scope 111', bookingId: b1.id })
  const created = (await pool.query('SELECT created_at FROM bookings WHERE id = $1', [b1.id])).rows[0].created_at as Date
  expect(new Date(a.bookedAt!).getTime()).toBe(created.getTime())
  expect(new Date(a.expiresAt).getTime()).toBe(new Date(q1.expiresAt).getTime())
  expect(o).toMatchObject({ status: 'sent', service: null, bookingId: null, bookedAt: null, scope: 'Scope 222' })

  // the provider's "Quotes sent" still works and also knows the booking; an outsider sees nothing of it
  const sent = (await listing(U.owner)).filter((d) => [q1.id, q2.id].includes(d.quoteId))
  expect(sent.map((d) => d.role)).toEqual(['provider', 'provider'])
  expect(sent.find((d) => d.quoteId === q1.id)).toMatchObject({ bookingId: b1.id, status: 'accepted' })
  expect((await listing(U.cust)).some((d) => [q1.id, q2.id].includes(d.quoteId))).toBe(false)
})

it('a booking made from a quote tells both sides the number of that quote', async () => {
  const r = await newRequest()
  const q = await sendQuote(U.owner, r, 130)
  const b = await (await confirming(q.id)).json()
  const number = (await listing(U.cust)).find((d) => d.quoteId === q.id)!.number
  for (const uid of [U.cust, U.owner]) {
    const view = BookingViewSchema.parse(await (await call(bookingRoute.GET, uid, 'GET', undefined, { id: b.id })).json())
    expect(view.quoteNumber).toBe(number)
  }
})

it('a quote whose booking has lapsed reads open again at once, before the cron runs, and the same after it', async () => {
  const r = await newRequest(pOwner, U.other)
  const q = await sendQuote(U.owner, r, 140)
  const b = await (await confirming(q.id, U.other)).json()
  const row = async () => (await listing(U.other)).find((d) => d.quoteId === q.id)!
  expect(await row()).toMatchObject({ status: 'accepted', bookingId: b.id })
  await pool.query("UPDATE bookings SET pay_by = now() - interval '1 day' WHERE id = $1", [b.id]) // the pay window has passed; no cron yet
  expect(await state('quotes', q.id)).toBe('accepted') // still stored as accepted
  expect(await row()).toMatchObject({ status: 'sent', bookingId: null, bookedAt: null })
  await runExpiryAndReminders(db, new Date())
  expect(await state('quotes', q.id)).toBe('sent') // the trigger wrote what the list showed
  expect(await row()).toMatchObject({ status: 'sent', bookingId: null, bookedAt: null })
})

it('two quotes with overlapping times confirmed at the same moment: one booking, one slot-pending', async () => {
  await relaxLimits(U.cust) // the earlier tests left open requests: keep the abuse limits out of the way
  const when = day()
  const r1 = await newRequest(pOwner, U.cust, { startAt: when })
  const r2 = await newRequest(pOwner, U.cust, { startAt: when })
  const q1 = await sendQuote(U.owner, r1, 100)
  const q2 = await sendQuote(U.owner, r2, 110)
  const res = await Promise.all([confirming(q1.id), confirming(q2.id)])
  expect(res.map((x) => x.status).sort()).toEqual([200, 409])
  const lost = res.find((x) => x.status === 409)!
  expect((await lost.json()).error).toBe('slot-pending')
  expect([await state('quotes', q1.id), await state('quotes', q2.id)].sort()).toEqual(['accepted', 'sent'])
})

it('the same quote confirmed twice at once makes one booking', async () => {
  await relaxLimits(U.cust)
  const q = await sendQuote(U.owner, await newRequest(), 150)
  const res = await Promise.all([confirming(q.id), confirming(q.id)])
  expect(res.map((x) => x.status).sort()).toEqual([200, 409])
  expect((await pool.query('SELECT count(*)::int n FROM bookings WHERE quote_id = $1', [q.id])).rows[0].n).toBe(1)
})
