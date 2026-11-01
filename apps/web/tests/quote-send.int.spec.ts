import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { QuoteSchema, RequestSchema } from '@kando/contract'
import { call, cleanupUsers, relaxLimits, requestTime, seedBase, seedProvider, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const requests = await import('../app/app-api/v1/requests/route')
const quotes = await import('../app/app-api/v1/requests/[id]/quotes/route')
const decline = await import('../app/app-api/v1/requests/[id]/decline/route')

const U = { cust: 'qs-cust', owner: 'qs-owner', other: 'qs-other', third: 'qs-third' }
let pOwner: string

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  for (const u of [U.cust, U.third]) await seedUser(u)
  pOwner = await seedProvider(U.owner, { name: 'Qs Owner', categoryId })
  await seedProvider(U.other, { name: 'Qs Other', categoryId })
})
afterAll(cleanupUsers)

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()
const newRequest = async (time: object = requestTime()) => {
  await relaxLimits(U.cust)
  return RequestSchema.parse(await (await call(requests.POST, U.cust, 'POST', { providerId: pOwner, description: 'Fix the fence', ...time })).json())
}
const send = (id: string, body: object, as = U.owner) => call(quotes.POST, as, 'POST', body, { id })
const row = async (id: string) => (await pool.query('SELECT status, start_at, duration_min, proposed_other_time, expires_at FROM quotes WHERE id = $1', [id])).rows[0]
const notices = async (user: string, kind: string) => (await pool.query('SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND kind = $2', [user, kind])).rows[0].n
const said = (requestId: string, sender: string) =>
  pool.query("INSERT INTO messages (thread_id, sender_id, kind, body) SELECT id, $2, 'text', 'Hello' FROM threads WHERE request_id = $1", [requestId, sender])

it('a quote with the request\'s own time is the accept: not a proposal, and the customer gets the quote notice', async () => {
  const r = await newRequest()
  const before = await notices(U.cust, 'quote-received')
  const res = await send(r.id, { amount: 120, scope: 'Fence', startAt: r.startAt, durationMin: r.durationMin })
  expect(res.status).toBe(201)
  const q = QuoteSchema.parse(await res.json())
  expect(await row(q.id)).toMatchObject({ status: 'sent', proposed_other_time: false })
  expect(await notices(U.cust, 'quote-received')).toBe(before + 1)
})

it('a quote with another time proposes it: flagged, replaces the earlier quote, and the customer gets the time-proposed notice', async () => {
  const r = await newRequest()
  const first = QuoteSchema.parse(await (await send(r.id, { amount: 120, scope: 'Fence', startAt: r.startAt, durationMin: r.durationMin })).json())
  const before = await notices(U.cust, 'time-proposed')
  const res = await send(r.id, { amount: 120, scope: 'Fence', startAt: day(12), durationMin: 120 })
  expect(res.status).toBe(201)
  const second = QuoteSchema.parse(await res.json())
  expect(await row(second.id)).toMatchObject({ status: 'sent', proposed_other_time: true })
  expect((await row(first.id)).status).toBe('superseded')
  expect(await notices(U.cust, 'time-proposed')).toBe(before + 1)
})

it('a quote without a date and time is allowed ("to be confirmed")', async () => {
  const r = await newRequest()
  const res = await send(r.id, { amount: 80, scope: 'Fence' })
  expect(res.status).toBe(201)
  const q = QuoteSchema.parse(await res.json())
  expect(q).toMatchObject({ startAt: null, durationMin: null })
  expect(await row(q.id)).toMatchObject({ proposed_other_time: false })
})

it('a quote needs a price above zero, and a start without a duration is refused', async () => {
  const r = await newRequest()
  expect((await send(r.id, { amount: 0, scope: 'Fence' })).status).toBe(400)
  expect((await send(r.id, { scope: 'Fence' })).status).toBe(400)
  expect((await send(r.id, { amount: 50, scope: 'Fence', startAt: r.startAt })).status).toBe(400)
})

it('a quote expires after 7 days, or at its start time when that comes first', async () => {
  const soon = await newRequest({ ...requestTime(), startAt: day(3) })
  const q = QuoteSchema.parse(await (await send(soon.id, { amount: 50, scope: 'Fence', startAt: soon.startAt, durationMin: soon.durationMin })).json())
  expect(new Date(q.expiresAt).getTime()).toBe(new Date(soon.startAt!).getTime())
  const far = await newRequest()
  const q2 = QuoteSchema.parse(await (await send(far.id, { amount: 50, scope: 'Fence', startAt: far.startAt, durationMin: far.durationMin })).json())
  expect(new Date(q2.expiresAt).getTime() - new Date(q2.createdAt).getTime()).toBe(7 * 86_400_000)
})

it('a time that clashes with a held booking is refused with slot-pending, but a quote without a time is not', async () => {
  const when = day(40)
  await pool.query(
    `INSERT INTO bookings (customer_id, provider_id, source, status, start_at, duration_min, amount, currency, on_site, pay_by, accepted_at)
     VALUES ($1, $2, 'direct', 'awaiting-payment', $3, 60, 50, 'EUR', true, now() + interval '2 days', now())`,
    [U.third, pOwner, when],
  )
  const r = await newRequest({ ...requestTime(), startAt: when })
  const clash = await send(r.id, { amount: 50, scope: 'Fence', startAt: when, durationMin: 60 })
  expect([clash.status, (await clash.json()).error]).toEqual([409, 'slot-pending'])
  expect((await send(r.id, { amount: 50, scope: 'Fence' })).status).toBe(201)
})

it('a second different time from the provider needs a chat message from the customer first', async () => {
  const r = await newRequest()
  expect((await send(r.id, { amount: 90, scope: 'Fence', startAt: day(12), durationMin: 120 })).status).toBe(201)
  const again = await send(r.id, { amount: 90, scope: 'Fence', startAt: day(13), durationMin: 120 })
  expect([again.status, (await again.json()).error]).toEqual([409, 'chat-first'])
  await said(r.id, U.cust)
  expect((await send(r.id, { amount: 90, scope: 'Fence', startAt: day(13), durationMin: 120 })).status).toBe(201)
})

it('only the provider of the request quotes it; a rejection ends the request and tells the customer', async () => {
  const r = await newRequest()
  expect((await send(r.id, { amount: 50, scope: 'x' }, U.other)).status).toBe(404)
  expect((await send(r.id, { amount: 50, scope: 'x' }, U.cust)).status).toBe(404)
  const before = await notices(U.cust, 'request-declined')
  expect((await call(decline.POST, U.owner, 'POST', undefined, { id: r.id })).status).toBe(200)
  expect(await notices(U.cust, 'request-declined')).toBe(before + 1)
  expect((await pool.query('SELECT status FROM requests WHERE id = $1', [r.id])).rows[0].status).toBe('declined')
  expect((await send(r.id, { amount: 50, scope: 'x' })).status).toBe(409)
})
