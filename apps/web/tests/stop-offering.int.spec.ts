import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { call, cleanupUsers, makeAwaitingPayment, makeQuote, seedBase, seedProvider, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const stop = await import('../app/app-api/v1/me/stop-offering/route')
const draftRoute = await import('../app/app-api/v1/provider-profile/route')
const searchRoute = await import('../app/app-api/v1/providers/route')
const pageRoute = await import('../app/app-api/v1/providers/[slug]/route')

const U = { cust: 'so-cust', a: 'so-a', b: 'so-b', other: 'so-other', plain: 'so-plain' }
let pA: string, pB: string

const search = async () => JSON.stringify(await (await searchRoute.GET(new Request('http://localhost/app-api/v1/providers?postcode=10115'), { params: Promise.resolve({}) })).json())
const isProvider = async (id: string) => (await pool.query('SELECT is_provider FROM users WHERE id = $1', [id])).rows[0].is_provider
const start = new Date(Date.now() + 10 * 86_400_000)

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  await seedUser(U.cust)
  await seedUser(U.plain)
  pA = await seedProvider(U.a, { name: 'So Alpha', categoryId })
  pB = await seedProvider(U.b, { name: 'So Beta', categoryId })
  await pool.query('UPDATE users SET is_provider = true WHERE id = ANY($1)', [[U.a, U.b]])
})
afterAll(cleanupUsers)

it('is refused while a booking is open, and changes nothing', async () => {
  const booking = await makeAwaitingPayment({ customerId: U.cust, ownerId: U.a, providerId: pA, startAt: start })
  const res = await call(stop.POST, U.a, 'POST')
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'OFFER_HAS_OPEN_JOBS' })
  expect(await isProvider(U.a)).toBe(true)
  expect((await pool.query('SELECT status FROM providers WHERE id = $1', [pA])).rows[0].status).toBe('published')
  await pool.query("UPDATE bookings SET status = 'completed' WHERE id = $1", [booking.id])
})

it('is refused while a quote is waiting, and while money is paid but not released', async () => {
  const { request } = await makeQuote({ customerId: U.cust, ownerId: U.a, providerId: pA, startAt: new Date(start.getTime() + 86_400_000) })
  expect((await call(stop.POST, U.a, 'POST')).status).toBe(409)
  await pool.query("UPDATE requests SET status = 'withdrawn' WHERE id = $1", [request.id])
  await pool.query("UPDATE quotes SET status = 'expired' WHERE request_id = $1", [request.id])
  const done = (await pool.query("SELECT id FROM bookings WHERE provider_id = $1 AND status = 'completed'", [pA])).rows[0].id
  await pool.query('UPDATE bookings SET paid_at = now(), released_at = NULL WHERE id = $1', [done])
  expect((await call(stop.POST, U.a, 'POST')).status).toBe(409)
  await pool.query('UPDATE bookings SET released_at = now() WHERE id = $1', [done])
})

it('succeeds when nothing is open: hidden from search and the page, past data kept, idempotent', async () => {
  expect(await search()).toContain(`${U.a}-slug`)
  const res = await call(stop.POST, U.a, 'POST')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
  expect(await isProvider(U.a)).toBe(false)
  expect(await search()).not.toContain(`${U.a}-slug`)
  expect((await call(pageRoute.GET, U.cust, 'GET', undefined, { slug: `${U.a}-slug` })).status).toBe(404)
  expect((await pool.query('SELECT status FROM providers WHERE id = $1', [pA])).rows[0].status).toBe('draft')
  expect((await pool.query('SELECT 1 FROM services WHERE provider_id = $1', [pA])).rows).toHaveLength(1)
  expect((await pool.query("SELECT 1 FROM bookings WHERE provider_id = $1 AND status = 'completed'", [pA])).rows).toHaveLength(1)
  expect((await call(stop.POST, U.a, 'POST')).status).toBe(200) // again: fine
  expect(await isProvider(U.a)).toBe(false)
})

it('a person who never offered gets success', async () => {
  expect((await call(stop.POST, U.plain, 'POST')).status).toBe(200)
})

it('cannot affect someone else', async () => {
  await seedUser(U.other)
  expect((await call(stop.POST, U.other, 'POST')).status).toBe(200)
  expect(await isProvider(U.b)).toBe(true)
  expect((await pool.query('SELECT status FROM providers WHERE id = $1', [pB])).rows[0].status).toBe('published')
})

it('can offer again: the old draft comes back, no second profile', async () => {
  expect((await call(draftRoute.POST, U.a, 'POST')).status).toBe(200)
  expect(await isProvider(U.a)).toBe(true)
  expect((await pool.query('SELECT id FROM providers WHERE owner_id = $1', [U.a])).rows.map((r) => r.id)).toEqual([pA])
})

it('a paid booking that was cancelled or refunded never releases and does not block stopping', async () => {
  await pool.query("UPDATE providers SET status = 'published' WHERE id = $1", [pA]) // offered again earlier: back online for this case
  const booking = await makeAwaitingPayment({ customerId: U.cust, ownerId: U.a, providerId: pA, startAt: new Date(start.getTime() + 3 * 86_400_000) })
  await pool.query("UPDATE bookings SET status = 'refunded', paid_at = now(), released_at = NULL WHERE id = $1", [booking.id])
  expect((await call(stop.POST, U.a, 'POST')).status).toBe(200)
})
