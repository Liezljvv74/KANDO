import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { requestTime, call, cleanupUsers, expireQuotes, seedBase, seedProvider, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const requests = await import('../app/app-api/v1/requests/route')
const bookingsRoute = await import('../app/app-api/v1/bookings/route')
const quotesRoute = await import('../app/app-api/v1/requests/[id]/quotes/route')

const U = { c1: 'al-c1', c2: 'al-c2', c3: 'al-c3', c4: 'al-c4', c5: 'al-c5', owner: 'al-owner', owner2: 'al-owner2' }
let pOwner: string, pOwner2: string, sOwner2: string

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  for (const u of [U.c1, U.c2, U.c3, U.c4, U.c5]) await seedUser(u)
  pOwner = await seedProvider(U.owner, { name: 'Al Owner', categoryId })
  pOwner2 = await seedProvider(U.owner2, { name: 'Al Owner2', categoryId })
  sOwner2 = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [pOwner2])).rows[0].id
})
afterAll(cleanupUsers)

const req = (as: string, providerId = pOwner, description = 'Fix the fence') => call(requests.POST, as, 'POST', { providerId, description, ...requestTime() })
const book = (as: string, n: number) =>
  call(bookingsRoute.POST, as, 'POST', { serviceId: sOwner2, startAt: new Date(Date.now() + (200 + n) * 86_400_000).toISOString(), durationMin: 60, onSite: true, address: { postcode: '10115' } })
const count = async (uid: string) =>
  (await pool.query('SELECT (SELECT count(*) FROM requests WHERE customer_id = $1)::int r, (SELECT count(*) FROM bookings WHERE customer_id = $1)::int b', [uid])).rows[0]

it('a second open request to the same provider is 409 request-limit; after it expires or is booked a new one is allowed', async () => {
  const first = await req(U.c1)
  expect(first.status).toBe(201)
  const id = (await first.json()).id as string
  const second = await req(U.c1)
  expect(second.status).toBe(409)
  expect(await second.json()).toEqual({ error: 'request-limit' })
  expect((await count(U.c1)).r).toBe(1) // nothing was saved
  expect((await req(U.c1, pOwner2)).status).toBe(201) // another provider is fine
  expect((await req(U.c2)).status).toBe(201) // another customer is fine
  expect((await call(quotesRoute.POST, U.owner, 'POST', { amount: 10, scope: 'Fence' }, { id })).status).toBe(201)
  expect((await req(U.c1)).status).toBe(409) // quoted (with a live quote) still counts
  await pool.query("UPDATE requests SET status = 'expired' WHERE id = $1", [id])
  expect((await req(U.c1)).status).toBe(201)
  await pool.query("UPDATE requests SET status = 'booked' WHERE customer_id = $1 AND provider_id = $2", [U.c1, pOwner])
  expect((await req(U.c1)).status).toBe(201)
})

it('a quoted request whose quote has expired no longer counts toward the pair limit, before the daily timer runs', async () => {
  const id = (await (await req(U.c5)).json()).id as string
  expect((await call(quotesRoute.POST, U.owner, 'POST', { amount: 10, scope: 'Fence' }, { id })).status).toBe(201)
  expect((await req(U.c5)).status).toBe(409) // a live quote counts
  await expireQuotes('request_id = $1', [id])
  expect((await req(U.c5)).status).toBe(201)
})

it('the 11th request or direct booking in 24 hours is 409 daily-limit', async () => {
  // 6 requests (each to a fresh provider row would be slow): close them so the pair limit does not interfere
  for (let i = 0; i < 6; i++) {
    expect((await req(U.c3)).status).toBe(201)
    await pool.query("UPDATE requests SET status = 'withdrawn' WHERE customer_id = $1", [U.c3])
  }
  for (let i = 0; i < 4; i++) expect((await book(U.c3, i)).status).toBe(201)
  const before = await count(U.c3)
  expect(before).toEqual({ r: 6, b: 4 })
  const r = await req(U.c3)
  expect(r.status).toBe(409)
  expect(await r.json()).toEqual({ error: 'daily-limit' })
  const b = await book(U.c3, 9)
  expect(b.status).toBe(409)
  expect(await b.json()).toEqual({ error: 'daily-limit' })
  expect(await count(U.c3)).toEqual(before)
  await pool.query("UPDATE requests SET created_at = now() - interval '25 hours' WHERE customer_id = $1", [U.c3])
  expect((await req(U.c3)).status).toBe(201) // the window moves on
})

it('two parallel creates cannot both pass the limit', async () => {
  const holder = await pool.connect()
  let both: Promise<Response[]>
  try {
    await holder.query('BEGIN')
    await holder.query("SELECT pg_advisory_xact_lock(hashtext('request_limit'), hashtext($1))", [U.c4])
    both = Promise.all([req(U.c4), req(U.c4)])
    await new Promise((ok) => setTimeout(ok, 500))
    expect((await count(U.c4)).r).toBe(0) // both wait for the customer's lock
    await holder.query('COMMIT')
  } finally {
    holder.release()
  }
  expect((await both).map((x) => x.status).sort()).toEqual([201, 409])
  expect((await count(U.c4)).r).toBe(1)
})
