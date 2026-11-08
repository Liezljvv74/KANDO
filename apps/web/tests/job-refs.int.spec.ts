import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { pool } from '@kando/db'
import { BookingSchema, QuoteSchema, RequestSchema } from '@kando/contract'
import { call, cleanupUsers, makeAwaitingPayment, seedBase, seedProvider, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const startRoute = await import('../app/app-api/v1/bookings/[id]/additional-task/route')
const quoteRoute = await import('../app/app-api/v1/requests/[id]/quotes/route')
const acceptRoute = await import('../app/app-api/v1/quotes/[id]/accept/route')
const listRoute = await import('../app/app-api/v1/bookings/route')
const bookingRoute = await import('../app/app-api/v1/bookings/[id]/route')
const requestRoute = await import('../app/app-api/v1/requests/[id]/route')

const U = { cust: 'jr-cust', owner: 'jr-owner', owner2: 'jr-owner2' }
const HOUR = 3_600_000
let categoryId: string
let providerId: string
let provider2: string

beforeAll(async () => {
  await cleanupUsers()
  ;({ categoryId } = await seedBase())
  await pool.query("INSERT INTO category_texts (category_id, lang, name) VALUES ($1, 'de', 'Gartenpflege'), ($1, 'en', 'Gardening') ON CONFLICT DO NOTHING", [categoryId])
  await seedUser(U.cust)
  await pool.query("UPDATE users SET language = 'en' WHERE id = $1", [U.cust])
  for (const [u, n] of [[U.owner, 'Jr Owner'], [U.owner2, 'Jr Owner Two']] as const) {
    const id = await seedProvider(u, { name: n, categoryId, price: 100 })
    await pool.query("UPDATE providers SET stripe_account_id = $2, payouts_ready_at = now(), invoice_consent_at = now() WHERE id = $1", [id, `acct_${u}`])
    if (u === U.owner) providerId = id
    else provider2 = id
  }
})
afterAll(cleanupUsers)

/** A confirmed, paid root booking made from a real request and quote (so it has a request and a job number). */
async function paidJob(owner: string, pid: string) {
  const startAt = new Date(Date.now() - 3 * HOUR)
  const b = await makeAwaitingPayment({ customerId: U.cust, ownerId: owner, providerId: pid, serviceId: (await pool.query('SELECT id FROM services WHERE provider_id = $1', [pid])).rows[0].id, startAt: new Date(Date.now() + 5 * 86_400_000) })
  const ref = `pi_jr_${randomUUID()}`
  await pool.query("UPDATE bookings SET status = 'confirmed', start_at = $2, paid_at = now(), payment_ref = $3, commission_rate = 0.12, pay_by = $2 WHERE id = $1", [b.id, startAt, ref])
  await pool.query("INSERT INTO ledger_entries (booking_id, provider_id, kind, amount, gateway_ref, idempotency_key) VALUES ($1, $2, 'charge', 100, $4, $3)", [b.id, pid, `charge:${b.id}`, ref])
  return b
}
const child = async (parent: string) => {
  const r = RequestSchema.parse(await (await call(startRoute.POST, U.cust, 'POST', { description: 'Noch das Gartentor streichen' }, { id: parent })).json())
  const q = QuoteSchema.parse(await (await call(quoteRoute.POST, U.owner, 'POST', { amount: 40, scope: 'Gartentor' }, { id: r.id })).json())
  const res = await call(acceptRoute.POST, U.cust, 'POST', {}, { id: q.id })
  expect(res.status).toBe(200)
  return { request: r, booking: BookingSchema.parse(await res.json()) }
}
const getBooking = async (id: string, as = U.cust) => BookingSchema.parse((await (await call(bookingRoute.GET, as, 'GET', undefined, { id })).json()).booking)

it('request and booking carry the job number, the provider title and #N', async () => {
  const root = await paidJob(U.owner, providerId)
  const n = (await pool.query('SELECT r.job_number, r.category_id FROM requests r WHERE r.id = $1', [root.requestId])).rows[0]
  expect(n.category_id).toBe(categoryId) // set at creation
  expect(root).toMatchObject({ jobNumber: n.job_number, title: 'Jr Owner service', taskNumber: `#${n.job_number}` })
  const asProvider = await getBooking(root.id, U.owner)
  expect(asProvider).toMatchObject({ jobNumber: n.job_number, taskNumber: `#${n.job_number}` })
  const req = RequestSchema.parse(await (await call(requestRoute.GET, U.cust, 'GET', undefined, { id: root.requestId! })).json())
  expect(req).toMatchObject({ jobNumber: n.job_number, title: 'Jr Owner service' })
})

it('the title falls back to the category name once the service is deleted', async () => {
  const root = await paidJob(U.owner2, provider2)
  await pool.query('DELETE FROM services WHERE provider_id = $1', [provider2])
  expect((await getBooking(root.id)).title).toBe('Gardening')
  const req = RequestSchema.parse(await (await call(requestRoute.GET, U.cust, 'GET', undefined, { id: root.requestId! })).json())
  expect(req.title).toBe('Gardening')
})

it('an additional task shows the root number, #N-2 and #N-3 (a withdrawn one still counts), the same in every batch', async () => {
  const root = await paidJob(U.owner, providerId)
  const n = (await pool.query('SELECT job_number FROM requests WHERE id = $1', [root.requestId])).rows[0].job_number as number
  const one = await child(root.id)
  expect(one.request.jobNumber).toBe(n) // the task's own request shows its job's number, not its own
  expect(one.booking).toMatchObject({ jobNumber: n, taskNumber: `#${n}-2`, title: 'Jr Owner service' })
  const own = (await pool.query('SELECT job_number FROM requests WHERE id = $1', [one.request.id])).rows[0].job_number as number
  expect(own).not.toBe(n) // its own database number stays unused
  await pool.query("UPDATE bookings SET status = 'withdrawn' WHERE id = $1", [one.booking.id])
  await pool.query("UPDATE requests SET status = 'booked' WHERE id = $1", [one.request.id])
  const two = await child(root.id)
  expect(two.booking).toMatchObject({ jobNumber: n, taskNumber: `#${n}-3` })
  const list = (await (await call(listRoute.GET, U.cust)).json()).docs.map((d: unknown) => BookingSchema.parse(d))
  const by = (id: string) => list.find((b: { id: string }) => b.id === id)
  expect(by(root.id)?.taskNumber).toBe(`#${n}`)
  expect(by(one.booking.id)?.taskNumber).toBe(`#${n}-2`)
  expect(by(two.booking.id)?.taskNumber).toBe(`#${n}-3`)
  expect((await getBooking(two.booking.id, U.owner)).taskNumber).toBe(`#${n}-3`) // alone, and as the provider
})

it('jobsForNotices: an additional task resolves to the root job; the other party is the customer for the provider and the provider for the customer; unknown ids give null', async () => {
  const { jobsForNotices } = await import('@kando/domain')
  await pool.query("UPDATE users SET first_name = 'Clara', last_name = 'Kunde' WHERE id = $1", [U.cust])
  const root = await paidJob(U.owner, providerId)
  const n = (await pool.query('SELECT job_number FROM requests WHERE id = $1', [root.requestId])).rows[0].job_number
  const { request, booking } = await child(root.id)
  const refs = [{ bookingId: booking.id }, { requestId: request.id }, { bookingId: root.id }, { bookingId: randomUUID() }, { requestId: randomUUID() }]
  const { db } = await import('@kando/db')
  const asCust = await jobsForNotices(db as never, U.cust, refs)
  expect(asCust.slice(0, 3).map((j) => [j?.id, j?.number, j?.title])).toEqual(Array(3).fill([root.requestId, n, 'Jr Owner service'])) // the additional task shows the ROOT job
  expect(asCust[0]!.otherParty).toBe((await pool.query('SELECT public_name FROM providers WHERE id = $1', [providerId])).rows[0].public_name)
  expect(asCust.slice(3)).toEqual([null, null])
  // the page that shows each ref: the task's own request (for its booking and its request), the root booking's request
  expect(asCust.slice(0, 3).map((j) => j?.requestId)).toEqual([request.id, request.id, root.requestId])
  const asOwner = await jobsForNotices(db as never, U.owner, refs)
  expect(asOwner[0]!.otherParty).toBe('Clara K.')
  expect(asOwner[2]!.number).toBe(n)
})

it('GET /requests/:id carries the job page fields: the other party for each side, the bookings oldest first and the current one', async () => {
  await pool.query("UPDATE users SET first_name = 'Clara', last_name = 'Kunde' WHERE id = $1", [U.cust])
  const root = await paidJob(U.owner, providerId)
  const asCust = RequestSchema.parse(await (await call(requestRoute.GET, U.cust, 'GET', undefined, { id: root.requestId! })).json())
  expect(asCust).toMatchObject({ bookingIds: [root.id], currentBookingId: root.id, otherParty: (await pool.query('SELECT public_name FROM providers WHERE id = $1', [providerId])).rows[0].public_name })
  const asOwner = RequestSchema.parse(await (await call(requestRoute.GET, U.owner, 'GET', undefined, { id: root.requestId! })).json())
  expect(asOwner).toMatchObject({ otherParty: 'Clara K.', currentBookingId: root.id })
  // an older dead booking stays listed; the live one is current
  const old = (await pool.query("INSERT INTO bookings (customer_id, provider_id, service_id, quote_id, request_id, source, status, start_at, duration_min, amount, currency, on_site, created_at) SELECT customer_id, provider_id, service_id, quote_id, request_id, source, 'expired', start_at, duration_min, amount, currency, on_site, created_at - interval '1 day' FROM bookings WHERE id = $1 RETURNING id", [root.id])).rows[0].id
  const again = RequestSchema.parse(await (await call(requestRoute.GET, U.cust, 'GET', undefined, { id: root.requestId! })).json())
  expect(again).toMatchObject({ bookingIds: [old, root.id], currentBookingId: root.id })
})

it('an additional task whose root booking has no request shows no job refs (not its own unused number)', async () => {
  const { jobsForNotices } = await import('@kando/domain')
  const { db } = await import('@kando/db')
  const root = await paidJob(U.owner, providerId)
  const r = RequestSchema.parse(await (await call(startRoute.POST, U.cust, 'POST', { description: 'Noch etwas' }, { id: root.id })).json())
  const c = await pool.connect() // as a direct booking: the guard trigger forbids the change, so it is off for this one statement
  try {
    await c.query('BEGIN')
    await c.query("SET LOCAL session_replication_role = 'replica'")
    await c.query('UPDATE bookings SET request_id = NULL WHERE id = $1', [root.id])
    await c.query('COMMIT')
  } finally {
    c.release()
  }
  const got = RequestSchema.parse(await (await call(requestRoute.GET, U.cust, 'GET', undefined, { id: r.id })).json())
  expect(got.jobNumber).toBeUndefined()
  expect(await jobsForNotices(db as never, U.cust, [{ requestId: r.id }])).toEqual([null])
})
