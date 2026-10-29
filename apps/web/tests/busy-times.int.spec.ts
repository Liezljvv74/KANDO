import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { BookingSchema, BusyTimeSchema } from '@kando/contract'
import { call, cleanupUsers, seedBase, seedProvider, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const bookingsRoute = await import('../app/app-api/v1/bookings/route')
const answer = await import('../app/app-api/v1/bookings/[id]/answer/route')
const withdraw = await import('../app/app-api/v1/bookings/[id]/withdraw/route')
const busyRoute = await import('../app/app-api/v1/providers/[slug]/busy/route')

const U = { cust: 'bz-cust', cust2: 'bz-cust2', owner: 'bz-owner', susp: 'bz-susp', draft: 'bz-draft' }
let pOwner: string, sOwner: string

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  for (const u of [U.cust, U.cust2]) await seedUser(u)
  pOwner = await seedProvider(U.owner, { name: 'Bz Owner', categoryId })
  await seedProvider(U.susp, { name: 'Bz Susp', categoryId, suspended: true })
  await seedProvider(U.draft, { name: 'Bz Draft', categoryId, status: 'draft' })
  sOwner = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [pOwner])).rows[0].id
})
afterAll(cleanupUsers)

const day = (n: number, h = 0) => new Date(Date.now() + n * 86_400_000 + h * 3_600_000).toISOString()
const book = async (startAt: string, as = U.cust) =>
  BookingSchema.parse(await (await call(bookingsRoute.POST, as, 'POST', { serviceId: sOwner, startAt, durationMin: 60, onSite: true, address: { postcode: '10115', street: 'Hauptstr. 1' } })).json())
const accept = (id: string) => call(answer.POST, U.owner, 'POST', { type: 'accept' }, { id })
const busy = (slug: string, from: string, to: string, headers: HeadersInit = {}) =>
  busyRoute.GET(new Request(`http://localhost/app-api/v1/providers/${slug}/busy?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers }), { params: Promise.resolve({ slug }) })
const slug = `${U.owner}-slug`

it('busy times show pending ranges but no names or ids', async () => {
  const a = await book(day(200, 10))
  await accept(a.id)
  const res = await busy(slug, day(199), day(202), { cookie: `uid=${U.cust}:x` })
  expect(res.status).toBe(200)
  const { docs } = await res.json()
  expect(docs).toHaveLength(1)
  expect(Object.keys(docs[0]).sort()).toEqual(['endAt', 'startAt', 'state'])
  expect(BusyTimeSchema.parse(docs[0])).toEqual({ startAt: a.startAt, endAt: new Date(new Date(a.startAt).getTime() + 3_600_000).toISOString(), state: 'pending' })
  expect(JSON.stringify(docs)).not.toMatch(new RegExp(`${a.id}|${U.cust}|Hauptstr|10115`))
})

it('an anonymous caller can read them; a proposed booking does not show; ranges are ordered', async () => {
  const late = await book(day(210, 15))
  const early = await book(day(210, 9), U.cust2)
  await book(day(210, 12)) // still proposed: not shown
  await accept(late.id)
  await accept(early.id)
  const res = await busy(slug, day(209), day(212))
  expect(res.status).toBe(200)
  const docs = (await res.json()).docs as { startAt: string }[]
  expect(docs.map((d) => d.startAt)).toEqual([early.startAt, late.startAt])
})

it('a range over 62 days or a bad range is 400', async () => {
  expect((await busy(slug, day(1), day(64))).status).toBe(400)
  expect((await busy(slug, day(5), day(4))).status).toBe(400)
  expect((await busy(slug, 'nonsense', day(4))).status).toBe(400)
  expect((await busy(slug, day(1), day(62))).status).toBe(200)
})

it('unknown, unpublished and suspended providers are 404', async () => {
  for (const s of ['nobody-slug', `${U.draft}-slug`, `${U.susp}-slug`]) expect((await busy(s, day(1), day(5))).status).toBe(404)
})

it('a withdrawn or expired booking no longer shows; first come, first served', async () => {
  const start = day(220, 10)
  const first = await book(start)
  const second = await book(start, U.cust2) // a request on a pending time is allowed
  await accept(first.id)
  const shown = async () => ((await (await busy(slug, day(219), day(222))).json()).docs as unknown[]).length
  expect(await shown()).toBe(1)
  expect((await accept(second.id)).status).toBe(409) // refused while the first holds the time
  await call(withdraw.POST, U.cust, 'POST', undefined, { id: first.id })
  expect(await shown()).toBe(0)
  expect((await accept(second.id)).status).toBe(200)
  expect(await shown()).toBe(1)
  await pool.query("UPDATE bookings SET status = 'expired' WHERE id = $1", [second.id])
  expect(await shown()).toBe(0)
})
