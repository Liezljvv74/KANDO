import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { BookingSchema, BookingViewSchema, LIST_PAGE, QuoteSchema, RequestSchema } from '@kando/contract'
import { requestTime, call, cleanupUsers, EMAIL, makeAwaitingPayment, seedBase, seedProvider, seedUser, relaxLimits } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const bookingsRoute = await import('../app/app-api/v1/bookings/route')
const bookingOne = await import('../app/app-api/v1/bookings/[id]/route')
const requestsList = await import('../app/app-api/v1/requests/route')
const threadsList = await import('../app/app-api/v1/threads/route')
const withdraw = await import('../app/app-api/v1/bookings/[id]/withdraw/route')
const requests = await import('../app/app-api/v1/requests/route')
const quotes = await import('../app/app-api/v1/requests/[id]/quotes/route')
const confirm = await import('../app/app-api/v1/quotes/[id]/confirm/route')

const U = { cust: 'bk-cust', cust2: 'bk-cust2', owner: 'bk-owner', third: 'bk-third', pager: 'bk-pager' }
let pOwner: string
let sOwner: string

const serviceOf = async (providerId: string) => (await pool.query('SELECT id FROM services WHERE provider_id = $1', [providerId])).rows[0].id as string

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  for (const u of [U.cust, U.cust2, U.third, U.pager]) await seedUser(u)
  pOwner = await seedProvider(U.owner, { name: 'Bk Owner', categoryId })
  ;sOwner = await serviceOf(pOwner)
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
const listAs = async (uid: string, role: string) =>
  (
    await (
      await bookingsRoute.GET(new Request(`http://localhost/app-api/v1/bookings?role=${role}`, { headers: { cookie: `uid=${uid}:${EMAIL(uid)}` } }), { params: Promise.resolve({}) })
    ).json()
  ).docs as { id: string; address: unknown }[]

it('POST /bookings is gone: a new job is a request (the route only lists)', () => {
  expect(Object.keys(bookingsRoute).sort()).toEqual(['GET'])
})

it('a booking from the request flow: amount from the quote, payBy set, listed for both parties and not for a stranger', async () => {
  const b = await made(day(nextDay++), U.cust, { amount: 120 })
  expect(b).toMatchObject({ status: 'awaiting-payment', source: 'quote', customerId: U.cust, providerId: pOwner, amount: 120, currency: 'EUR', onSite: true, answerBy: null, address: { postcode: '10115' } })
  expect(b.payBy).not.toBeNull()
  expect((await listAs(U.cust, 'customer')).map((x) => x.id)).toContain(b.id)
  expect((await listAs(U.owner, 'provider')).map((x) => x.id)).toContain(b.id)
  expect((await listAs(U.third, 'customer')).map((x) => x.id)).not.toContain(b.id)
})

it('job address is hidden from the provider until the booking has a payment deadline', async () => {
  const b = await waiting()
  expect((await listAs(U.owner, 'provider')).find((x) => x.id === b.id)!.address).toBeNull()
  expect((await listAs(U.cust, 'customer')).find((x) => x.id === b.id)!.address).toMatchObject({ postcode: '10115' })
  const paying = await made()
  expect((await listAs(U.owner, 'provider')).find((x) => x.id === paying.id)!.address).toMatchObject({ postcode: '10115' })
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

const provAddr = async (id: string) => (await listAs(U.owner, 'provider')).find((x) => x.id === id)!.address

it('the provider never sees the address of a booking that never had a payment deadline; one that had stays visible after withdrawal', async () => {
  const withdrawn = await waiting()
  await withdrawing(withdrawn.id, U.cust)
  expect(await provAddr(withdrawn.id)).toBeNull()
  const accepted = await made()
  await withdrawing(accepted.id, U.cust)
  expect(await provAddr(accepted.id)).toMatchObject({ postcode: '10115' })
  expect((await listAs(U.cust, 'customer')).find((x) => x.id === withdrawn.id)!.address).toMatchObject({ postcode: '10115' })
})

it('the customer withdraws an awaiting-payment booking: its request and quote are open again and the provider can send a revised quote', async () => {
  const b = await made()
  const [requestId, quoteId] = [b.requestId!, b.quoteId!]
  expect([await statusOf('requests', requestId), await statusOf('quotes', quoteId)]).toEqual(['booked', 'accepted'])
  await pool.query('DELETE FROM notifications WHERE user_id = ANY($1)', [[U.cust, U.owner]])
  expect((await withdrawing(b.id, U.cust)).status).toBe(200)
  expect([await statusOf('requests', requestId), await statusOf('quotes', quoteId)]).toEqual(['quoted', 'sent'])
  expect([...(await noticesOf(b.id)), ...(await noticesOf(b.id, U.owner))]).toEqual([]) // the customer acted: nobody is told
  const revised = await call(quotes.POST, U.owner, 'POST', { amount: 90, scope: 'Fence, smaller' }, { id: requestId })
  expect(revised.status).toBe(201)
  expect(QuoteSchema.parse(await revised.json())).toMatchObject({ version: 2, status: 'sent' })
  expect(await statusOf('quotes', quoteId)).toBe('superseded')
})

const getAs = (handler: typeof bookingsRoute.GET, uid: string, query: string) =>
  handler(new Request(`http://localhost/app-api/v1/x?${query}`, { headers: { cookie: `uid=${uid}:${EMAIL(uid)}` } }), { params: Promise.resolve({}) })

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
  const kid = (await pool.query("INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, amount, parent_booking_id) SELECT customer_id, provider_id, service_id, 'direct', 'declined', start_at, 60, 5, id FROM bookings WHERE id = $1 RETURNING id", [b.id])).rows[0].id
  expect((await one(U.owner, kid)).body).toMatchObject({ viewer: 'provider', threadId, booking: { parentBookingId: b.id } })
  // no writes: an unpaid booking past its deadline reads expired but stays awaiting-payment in the row, and a missing thread is not created
  const late = await made()
  await pool.query("UPDATE bookings SET pay_by = now() - interval '1 hour' WHERE id = $1", [late.id])
  await pool.query('DELETE FROM threads WHERE request_id = $1', [late.requestId])
  expect((await one(U.cust, late.id)).body).toMatchObject({ viewer: 'customer', threadId: null, booking: { status: 'expired' } })
  expect((await row(late.id)).status).toBe('awaiting-payment')
  expect((await pool.query('SELECT count(*)::int AS n FROM threads WHERE request_id = $1', [late.requestId])).rows[0].n).toBe(0)
})

/** LIST_PAGE + 2 root bookings of the pager with one created_at (ties broken by id only); the lowest id is the last root. */
let pagerRows: Promise<string[]> | undefined
const pagerBookings = () =>
  (pagerRows ??= pool
    .query(
      "INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, amount, created_at) SELECT $1, $2, $3, 'direct', 'declined', now() + g * interval '1 day', 60, 10, '2026-01-01T00:00:00.123456Z' FROM generate_series(1, $4::int) g RETURNING id",
      [U.pager, pOwner, sOwner, LIST_PAGE + 2],
    )
    .then((r) => r.rows.map((x: { id: string }) => x.id)))
const pages = async (handler: typeof bookingsRoute.GET, uid: string, query: string) => {
  const out: { id: string; parentBookingId?: string | null }[][] = []
  let cursor: string | null = null
  do {
    const res = await getAs(handler, uid, `${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
    expect(res.status).toBe(200)
    const page = (await res.json()) as { docs: { id: string }[]; next: string | null }
    out.push(page.docs)
    cursor = page.next
  } while (cursor && out.length < 10)
  return out
}

it('cursor pages over equal createdAt without loss', async () => {
  const made = await pagerBookings()
  const got = await pages(bookingsRoute.GET, U.pager, 'role=customer')
  expect(got.map((p) => p.length)).toEqual([LIST_PAGE, 2])
  const ids = got.flat().map((b) => b.id)
  expect(ids).toHaveLength(made.length) // none twice
  expect([...ids].sort()).toEqual([...made].sort()) // none lost
  expect(ids).toEqual([...made].sort().reverse()) // newest first, the id breaks the tie
})

it("an additional task follows its root on the root's page", async () => {
  const made = await pagerBookings()
  const root = [...made].sort()[0]!
  await pool.query("UPDATE bookings SET status = 'completed' WHERE id = $1", [root])
  const kid = (await pool.query("INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, amount, parent_booking_id, created_at) VALUES ($1, $2, $3, 'direct', 'declined', now() + interval '1 day', 60, 5, $4, now()) RETURNING id", [U.pager, pOwner, sOwner, root])).rows[0].id
  const got = await pages(bookingsRoute.GET, U.pager, 'role=customer')
  expect(got.map((p) => p.length)).toEqual([LIST_PAGE, 3]) // the newest row is a task: it does not open the first page
  expect(got[1]!.slice(-2).map((b) => b.id)).toEqual([root, kid])
})

it('a bad cursor is 400', async () => {
  const uuid = crypto.randomUUID()
  for (const q of ['cursor=garbage', `cursor=${encodeURIComponent(`yesterday|${uuid}`)}`, `cursor=${encodeURIComponent(`2026-02-30T00:00:00.000000Z|${uuid}`)}`, `cursor=${encodeURIComponent('2026-01-01T00:00:00.000Z|------------------------------------')}`, 'role=admin']) {
    expect((await getAs(bookingsRoute.GET, U.pager, q)).status, q).toBe(400)
    expect((await getAs(requestsList.GET, U.pager, q)).status, q).toBe(400)
  }
  expect((await getAs(threadsList.GET, U.pager, 'cursor=garbage')).status).toBe(400)
  expect((await getAs(bookingsRoute.GET, U.pager, `cursor=${encodeURIComponent(`2026-01-01T00:00:00.123456Z|${uuid}`)}`)).status).toBe(200)
})
