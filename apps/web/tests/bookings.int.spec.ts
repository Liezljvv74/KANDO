import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { BookingSchema, BookingViewSchema, LIST_PAGE, QuoteSchema, RequestSchema } from '@kando/contract'
import { call, cleanupUsers, EMAIL, seedBase, seedProvider, seedUser, relaxLimits } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const bookingsRoute = await import('../app/app-api/v1/bookings/route')
const bookingOne = await import('../app/app-api/v1/bookings/[id]/route')
const requestsList = await import('../app/app-api/v1/requests/route')
const threadsList = await import('../app/app-api/v1/threads/route')
const answer = await import('../app/app-api/v1/bookings/[id]/answer/route')
const withdraw = await import('../app/app-api/v1/bookings/[id]/withdraw/route')
const requests = await import('../app/app-api/v1/requests/route')
const quotes = await import('../app/app-api/v1/requests/[id]/quotes/route')
const accept = await import('../app/app-api/v1/quotes/[id]/accept/route')

const U = { cust: 'bk-cust', cust2: 'bk-cust2', owner: 'bk-owner', remote: 'bk-remote', susp: 'bk-susp', draft: 'bk-draft', third: 'bk-third', pager: 'bk-pager' }
let pOwner: string, pRemote: string, pSusp: string, pDraft: string
let sOwner: string, sRemote: string, sSusp: string, sDraft: string, sHourly: string

const serviceOf = async (providerId: string) => (await pool.query('SELECT id FROM services WHERE provider_id = $1', [providerId])).rows[0].id as string

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  for (const u of [U.cust, U.cust2, U.third, U.pager]) await seedUser(u)
  pOwner = await seedProvider(U.owner, { name: 'Bk Owner', categoryId })
  pRemote = await seedProvider(U.remote, { name: 'Bk Remote', categoryId, remote: true, price: 40 })
  pSusp = await seedProvider(U.susp, { name: 'Bk Susp', categoryId, suspended: true })
  pDraft = await seedProvider(U.draft, { name: 'Bk Draft', categoryId, status: 'draft' })
  ;sOwner = await serviceOf(pOwner)
  sRemote = await serviceOf(pRemote)
  sSusp = await serviceOf(pSusp)
  sDraft = await serviceOf(pDraft)
  sHourly = (await pool.query("INSERT INTO services (provider_id, category_id, title, price_type, price) VALUES ($1, $2, 'Hourly', 'hourly', 30) RETURNING id", [pOwner, categoryId])).rows[0].id
})
afterAll(cleanupUsers)

const day = (n: number, h = 0) => new Date(Date.now() + n * 86_400_000 + h * 3_600_000).toISOString()
let nextDay = 100 // every default proposal gets its own day, so accepted bookings never collide by accident
const proposal = (extra: object = {}) => ({ startAt: day(nextDay++), durationMin: 120, onSite: true, address: { postcode: '10115', street: 'Hauptstr. 1' }, ...extra })
const book = (as: string, serviceId: string, extra: object = {}) => call(bookingsRoute.POST, as, 'POST', { serviceId, ...proposal(extra) })
const direct = async (serviceId = sOwner, extra: object = {}, as = U.cust) => {
  await relaxLimits(as)
  return BookingSchema.parse(await (await book(as, serviceId, extra)).json())
}
const answering = (id: string, as: string, body: object) => call(answer.POST, as, 'POST', body, { id })
const withdrawing = (id: string, as: string) => call(withdraw.POST, as, 'POST', undefined, { id })
const row = async (id: string) => (await pool.query('SELECT status, pay_by, answer_by, counter_by, start_at, on_site, accepted_at FROM bookings WHERE id = $1', [id])).rows[0]
const listAs = async (uid: string, role: string) =>
  (
    await (
      await bookingsRoute.GET(new Request(`http://localhost/app-api/v1/bookings?role=${role}`, { headers: { cookie: `uid=${uid}:${EMAIL(uid)}` } }), { params: Promise.resolve({}) })
    ).json()
  ).docs as { id: string; address: unknown }[]

it('direct booking: fixed service, amount from the service, proposed with a 24h answer window', async () => {
  const res = await book(U.cust, sOwner, { amount: 1 }) // a client amount is ignored
  expect(res.status).toBe(201)
  const b = BookingSchema.parse(await res.json())
  expect(b).toMatchObject({ status: 'proposed', source: 'direct', quoteId: null, requestId: null, serviceId: sOwner, customerId: U.cust, providerId: pOwner, amount: 10, currency: 'EUR', onSite: true, payBy: null, counterBy: null, address: { postcode: '10115' } })
  expect(new Date(b.answerBy!).getTime() - new Date(b.createdAt).getTime()).toBe(24 * 3_600_000)
  expect((await listAs(U.cust, 'customer')).map((x) => x.id)).toContain(b.id)
  expect((await listAs(U.owner, 'provider')).map((x) => x.id)).toContain(b.id)
  expect((await listAs(U.third, 'customer')).map((x) => x.id)).not.toContain(b.id)
})

it('hourly or on-request service cannot be booked directly (400)', async () => {
  expect((await book(U.cust, sHourly)).status).toBe(400)
  await pool.query("UPDATE services SET price_type = 'on-request', price = NULL WHERE id = $1", [sHourly])
  expect((await book(U.cust, sHourly)).status).toBe(400)
})

it('past or absurd times, a missing address and an on-site booking with a non-remote provider are 400', async () => {
  for (const bad of [{ startAt: day(-1) }, { startAt: day(400) }, { durationMin: 5000 }, { address: undefined }, { onSite: false, address: undefined }]) {
    expect((await book(U.cust, sOwner, bad)).status).toBe(400)
  }
  expect((await book(U.cust, 'not-a-uuid')).status).toBe(400)
  const ok = await book(U.cust, sRemote, { onSite: false, address: undefined })
  expect(ok.status).toBe(201)
  expect(BookingSchema.parse(await ok.json())).toMatchObject({ onSite: false, address: null })
})

it('own service is 400; unpublished, suspended and unknown services are 404', async () => {
  expect((await book(U.owner, sOwner)).status).toBe(400)
  for (const s of [sSusp, sDraft, crypto.randomUUID()]) expect((await book(U.cust, s)).status).toBe(404)
})

it('job address is hidden from the provider until accepted', async () => {
  const b = await direct()
  const hidden = (await listAs(U.owner, 'provider')).find((x) => x.id === b.id)!
  expect(hidden.address).toBeNull()
  expect((await listAs(U.cust, 'customer')).find((x) => x.id === b.id)!.address).toMatchObject({ postcode: '10115' })
  const acc = BookingSchema.parse(await (await answering(b.id, U.owner, { type: 'accept' })).json())
  expect(acc.address).toMatchObject({ postcode: '10115' })
  expect((await listAs(U.owner, 'provider')).find((x) => x.id === b.id)!.address).toMatchObject({ postcode: '10115' })
})

it('provider accept: awaiting-payment with payBy 48h out (24h before a nearer start), counter and answerBy cleared', async () => {
  const b = await direct()
  const res = await answering(b.id, U.owner, { type: 'accept' })
  expect(res.status).toBe(200)
  const a = BookingSchema.parse(await res.json())
  expect(a).toMatchObject({ status: 'awaiting-payment', counterBy: null, answerBy: null })
  expect(new Date(a.payBy!).getTime() - new Date(a.updatedAt).getTime()).toBe(48 * 3_600_000)
  expect((await row(b.id)).accepted_at).toEqual(new Date(a.updatedAt)) // the payment reminders count from here
  expect((await answering(b.id, U.owner, { type: 'accept' })).status).toBe(409) // already answered
})

it('provider accepts a booking made from an accepted quote the same way as a direct one: status awaiting-payment and payBy set', async () => {
  const r = RequestSchema.parse(await (await call(requests.POST, U.cust, 'POST', { providerId: pOwner, description: 'Fix' })).json())
  const q = QuoteSchema.parse(await (await call(quotes.POST, U.owner, 'POST', { amount: 100, scope: 'Fence' }, { id: r.id })).json())
  const b = BookingSchema.parse(await (await call(accept.POST, U.cust, 'POST', proposal({ startAt: day(20) }), { id: q.id })).json())
  expect(b).toMatchObject({ source: 'quote', status: 'proposed', requestId: r.id, amount: 100 })
  expect((await row(b.id)).accepted_at).toBeNull()
  const res = await answering(b.id, U.owner, { type: 'accept' })
  expect(res.status).toBe(200)
  expect(BookingSchema.parse(await res.json())).toMatchObject({ status: 'awaiting-payment', amount: 100 })
  expect((await row(b.id)).pay_by).not.toBeNull()
})

it('provider counters; customer accepts the counter', async () => {
  const b = await direct()
  const newStart = day(12)
  const c = BookingSchema.parse(await (await answering(b.id, U.owner, { type: 'counter', startAt: newStart, durationMin: 90, onSite: true })).json())
  expect(c).toMatchObject({ status: 'proposed', counterBy: 'provider', startAt: newStart, durationMin: 90 })
  expect(new Date(c.answerBy!).getTime() - new Date(c.updatedAt).getTime()).toBe(24 * 3_600_000)
  const a = BookingSchema.parse(await (await answering(b.id, U.cust, { type: 'accept' })).json())
  expect(a).toMatchObject({ status: 'awaiting-payment', counterBy: null, startAt: newStart })
  expect(a.payBy).not.toBeNull()
})

it('the customer can counter back; then the provider answers', async () => {
  const b = await direct()
  await answering(b.id, U.owner, { type: 'counter', startAt: day(13), durationMin: 90, onSite: true })
  const back = BookingSchema.parse(await (await answering(b.id, U.cust, { type: 'counter', startAt: day(14), durationMin: 60, onSite: true })).json())
  expect(back).toMatchObject({ status: 'proposed', counterBy: 'customer', durationMin: 60 })
  expect((await answering(b.id, U.cust, { type: 'accept' })).status).toBe(403)
  expect((await answering(b.id, U.owner, { type: 'accept' })).status).toBe(200)
})

it('only the provider can accept a customer proposal and only the customer a provider counter (403/404 otherwise)', async () => {
  const b = await direct()
  expect((await answering(b.id, U.cust, { type: 'accept' })).status).toBe(403)
  expect((await answering(b.id, U.third, { type: 'accept' })).status).toBe(404)
  expect((await answering(b.id, U.remote, { type: 'accept' })).status).toBe(404) // another provider
  expect((await answering(crypto.randomUUID(), U.owner, { type: 'accept' })).status).toBe(404)
  expect((await row(b.id)).status).toBe('proposed')
  await answering(b.id, U.owner, { type: 'counter', startAt: day(15), durationMin: 90, onSite: true })
  expect((await answering(b.id, U.owner, { type: 'accept' })).status).toBe(403)
  expect((await answering(b.id, U.third, { type: 'decline' })).status).toBe(404)
  expect((await answering(b.id, U.cust, { type: 'accept' })).status).toBe(200)
})

it('decline ends the booking; a counter to a past time or to remote with a non-remote provider is 400', async () => {
  const b = await direct()
  expect((await answering(b.id, U.owner, { type: 'counter', startAt: day(-1), durationMin: 60, onSite: true })).status).toBe(400)
  expect((await answering(b.id, U.owner, { type: 'counter', startAt: day(11), durationMin: 60, onSite: false })).status).toBe(400)
  const d = BookingSchema.parse(await (await answering(b.id, U.owner, { type: 'decline' })).json())
  expect(d.status).toBe('declined')
  expect((await answering(b.id, U.owner, { type: 'accept' })).status).toBe(409)
})

it('an unanswered proposal past its answerBy cannot be accepted', async () => {
  const b = await direct()
  await pool.query("UPDATE bookings SET answer_by = now() - interval '1 minute' WHERE id = $1", [b.id])
  expect((await answering(b.id, U.owner, { type: 'accept' })).status).toBe(409)
})

it('customer withdraws an awaiting-payment booking and the slot is free again', async () => {
  const start = day(30)
  const first = await direct(sOwner, { startAt: start })
  await answering(first.id, U.owner, { type: 'accept' })
  const second = await direct(sOwner, { startAt: day(30, 1) }, U.cust2) // overlaps the first
  expect((await answering(second.id, U.owner, { type: 'accept' })).status).toBe(409)
  expect((await withdrawing(first.id, U.owner)).status).toBe(403) // the provider cannot "withdraw"
  expect((await withdrawing(first.id, U.third)).status).toBe(404)
  const w = await withdrawing(first.id, U.cust)
  expect(w.status).toBe(200)
  expect(BookingSchema.parse(await w.json()).status).toBe('withdrawn')
  expect((await answering(second.id, U.owner, { type: 'accept' })).status).toBe(200)
  expect((await withdrawing(first.id, U.cust)).status).toBe(409) // already withdrawn
  expect((await withdrawing((await direct()).id, U.cust)).status).toBe(200) // from proposed too
})

it('slot rules: proposed never blocks; buffer only when both are on site; touching at the buffer is free', async () => {
  const base = day(40)
  const at = (offsetMin: number) => new Date(new Date(base).getTime() + offsetMin * 60_000).toISOString()
  const held = await direct(sRemote, { startAt: base, durationMin: 60 }) // on site, 60 min
  await direct(sRemote, { startAt: base, durationMin: 60 }, U.cust2) // a second proposed on the same time is fine
  expect((await answering(held.id, U.remote, { type: 'accept' })).status).toBe(200)
  const tryAccept = async (extra: object, as = U.cust2) => {
    const b = await direct(sRemote, extra, as)
    return (await answering(b.id, U.remote, { type: 'accept' })).status
  }
  expect(await tryAccept({ startAt: at(60 + 29), durationMin: 30 })).toBe(409) // inside the 30 min buffer, both on site
  expect(await tryAccept({ startAt: at(60 + 30), durationMin: 30 })).toBe(200) // exactly the buffer: free
  expect(await tryAccept({ startAt: at(60 + 10), durationMin: 15, onSite: false, address: undefined }, U.third)).toBe(200) // remote: no buffer, adjacent is free
  expect(await tryAccept({ startAt: at(30), durationMin: 60, onSite: false, address: undefined }, U.third)).toBe(409) // a real overlap still blocks
})

it('concurrent accept and withdraw: serialised on the booking row, no half-written result', async () => {
  const b = await direct(sOwner, { startAt: day(50) })
  // hold the booking row so both calls start together; the outcome must be consistent either way
  const holder = await pool.connect()
  let both: Promise<Response[]>
  try {
    await holder.query('BEGIN')
    await holder.query('SELECT 1 FROM bookings WHERE id = $1 FOR UPDATE', [b.id])
    both = Promise.all([answering(b.id, U.owner, { type: 'accept' }), withdrawing(b.id, U.cust)])
    await new Promise((ok) => setTimeout(ok, 500))
    expect((await holder.query('SELECT status FROM bookings WHERE id = $1', [b.id])).rows[0].status).toBe('proposed')
    await holder.query('COMMIT')
  } finally {
    holder.release()
  }
  const [acc, wd] = await both
  const r = await row(b.id)
  expect(wd!.status).toBe(200) // withdrawing is legal from proposed and from awaiting-payment
  expect(r.status).toBe('withdrawn')
  // an accept that ran first carries a payBy; one that ran after the withdrawal is refused and wrote nothing
  expect([acc!.status, r.pay_by !== null]).toEqual(acc!.status === 200 ? [200, true] : [409, false])
})

it('an accept that loses to a withdrawal is refused (409) and writes nothing', async () => {
  const b = await direct(sOwner, { startAt: day(55) })
  expect((await withdrawing(b.id, U.cust)).status).toBe(200)
  expect((await answering(b.id, U.owner, { type: 'accept' })).status).toBe(409)
  expect((await row(b.id)).pay_by).toBeNull()
})

it('two concurrent accepts of overlapping bookings: one 200, one 409', async () => {
  const start = day(60)
  const a = await direct(sOwner, { startAt: start })
  const c = await direct(sOwner, { startAt: day(60, 1) }, U.cust2)
  const holder = await pool.connect()
  let both: Promise<Response[]>
  try {
    await holder.query('BEGIN')
    await holder.query("SELECT pg_advisory_xact_lock(hashtext('booking_slot'), hashtext($1))", [pOwner])
    both = Promise.all([answering(a.id, U.owner, { type: 'accept' }), answering(c.id, U.owner, { type: 'accept' })])
    await new Promise((ok) => setTimeout(ok, 500))
    expect((await pool.query("SELECT count(*)::int n FROM bookings WHERE id = ANY($1) AND status = 'awaiting-payment'", [[a.id, c.id]])).rows[0].n).toBe(0)
    await holder.query('COMMIT')
  } finally {
    holder.release()
  }
  expect((await both).map((x) => x.status).sort()).toEqual([200, 409])
})

it('accept after the provider was suspended is 409', async () => {
  const b = await direct(sRemote, { startAt: day(70) })
  await pool.query("UPDATE providers SET suspended_until = now() + interval '1 day' WHERE id = $1", [pRemote])
  const status = (await answering(b.id, U.remote, { type: 'accept' })).status
  await pool.query('UPDATE providers SET suspended_until = NULL WHERE id = $1', [pRemote])
  expect(status).toBe(409)
  expect((await row(b.id)).status).toBe('proposed')
})

const provAddr = async (id: string) => (await listAs(U.owner, 'provider')).find((x) => x.id === id)!.address

it('the provider never sees the address of a booking that was not accepted; an accepted one stays visible after withdrawal', async () => {
  const declined = await direct(sOwner)
  await answering(declined.id, U.owner, { type: 'decline' })
  expect(await provAddr(declined.id)).toBeNull()
  const withdrawn = await direct(sOwner)
  await withdrawing(withdrawn.id, U.cust)
  expect(await provAddr(withdrawn.id)).toBeNull()
  const accepted = await direct(sOwner)
  await answering(accepted.id, U.owner, { type: 'accept' })
  await withdrawing(accepted.id, U.cust)
  expect(await provAddr(accepted.id)).toMatchObject({ postcode: '10115' })
  expect((await listAs(U.cust, 'customer')).find((x) => x.id === declined.id)!.address).toMatchObject({ postcode: '10115' })
})

it('a counter to remote clears the stored address', async () => {
  const b = await direct(sRemote)
  const c = BookingSchema.parse(await (await answering(b.id, U.remote, { type: 'counter', startAt: day(80), durationMin: 60, onSite: false })).json())
  expect(c).toMatchObject({ onSite: false, address: null })
  expect((await pool.query('SELECT address_postcode FROM bookings WHERE id = $1', [b.id])).rows[0].address_postcode).toBeNull()
})

it('a counter after the provider was suspended is 409', async () => {
  const b = await direct(sRemote)
  await pool.query("UPDATE providers SET suspended_until = now() + interval '1 day' WHERE id = $1", [pRemote])
  const status = (await answering(b.id, U.remote, { type: 'counter', startAt: day(81), durationMin: 60, onSite: true })).status
  await pool.query('UPDATE providers SET suspended_until = NULL WHERE id = $1', [pRemote])
  expect(status).toBe(409)
})

it('accepting a booking whose start has already passed is 400 start-in-past', async () => {
  const b = await direct()
  await pool.query("UPDATE bookings SET start_at = now() - interval '1 hour' WHERE id = $1", [b.id])
  const res = await answering(b.id, U.owner, { type: 'accept' })
  expect(res.status).toBe(400)
  expect((await res.json()).error).toBe('start-in-past')
  expect((await row(b.id)).status).toBe('proposed')
})

it('a customer accepting a provider counter that overlaps another customer\'s awaiting-payment hold gets 409 slot-pending', async () => {
  const base = day(90)
  const held = await direct(sOwner, { startAt: base, durationMin: 60 })
  expect((await answering(held.id, U.owner, { type: 'accept' })).status).toBe(200)
  const second = await direct(sOwner, { startAt: day(91), durationMin: 60 }, U.cust2)
  expect((await answering(second.id, U.owner, { type: 'counter', startAt: base, durationMin: 60, onSite: true })).status).toBe(200)
  const res = await answering(second.id, U.cust2, { type: 'accept' })
  expect(res.status).toBe(409)
  expect((await res.json()).error).toBe('slot-pending')
  expect((await row(second.id)).status).toBe('proposed')
})

it('a lapsed payment window no longer holds the slot before any sweep runs', async () => {
  const base = day(95)
  const held = await direct(sOwner, { startAt: base, durationMin: 60 })
  expect((await answering(held.id, U.owner, { type: 'accept' })).status).toBe(200)
  await pool.query("UPDATE bookings SET pay_by = now() - interval '1 minute' WHERE id = $1", [held.id])
  const second = await direct(sOwner, { startAt: base, durationMin: 60 }, U.cust2)
  expect((await answering(second.id, U.owner, { type: 'accept' })).status).toBe(200)
})

// A quote-born booking that ends unagreed reopens its request and quote (trigger bookings_reopen_request, rls.ts)
const quoteBorn = async (as = U.cust) => {
  await relaxLimits(as)
  const r = RequestSchema.parse(await (await call(requests.POST, as, 'POST', { providerId: pOwner, description: 'Fix' })).json())
  const q = QuoteSchema.parse(await (await call(quotes.POST, U.owner, 'POST', { amount: 100, scope: 'Fence' }, { id: r.id })).json())
  const b = BookingSchema.parse(await (await call(accept.POST, as, 'POST', proposal(), { id: q.id })).json())
  return { r, q, b }
}
const statusOf = async (table: 'requests' | 'quotes', id: string) => (await pool.query(`SELECT status FROM ${table} WHERE id = $1`, [id])).rows[0].status as string
const noticesOf = async (bookingId: string, uid = U.cust) => (await pool.query("SELECT user_id, kind, payload FROM notifications WHERE payload->>'bookingId' = $1 AND user_id = $2 ORDER BY kind", [bookingId, uid])).rows

it('provider declines a quote-born proposal: request quoted, quote sent, the customer can accept again and gets request-reopened', async () => {
  const { r, q, b } = await quoteBorn()
  expect([await statusOf('requests', r.id), await statusOf('quotes', q.id)]).toEqual(['booked', 'accepted'])
  expect((await answering(b.id, U.owner, { type: 'decline' })).status).toBe(200)
  expect([await statusOf('requests', r.id), await statusOf('quotes', q.id)]).toEqual(['quoted', 'sent'])
  expect(await noticesOf(b.id)).toEqual([{ user_id: U.cust, kind: 'request-reopened', payload: { requestId: r.id, bookingId: b.id } }])
  const again = await call(accept.POST, U.cust, 'POST', proposal(), { id: q.id })
  expect(again.status).toBe(200)
  expect(BookingSchema.parse(await again.json())).toMatchObject({ status: 'proposed', quoteId: q.id, requestId: r.id })
  expect([await statusOf('requests', r.id), await statusOf('quotes', q.id)]).toEqual(['booked', 'accepted'])
})

it('the customer withdraws an awaiting-payment booking: the provider can send a revised quote', async () => {
  const { r, q, b } = await quoteBorn()
  expect((await answering(b.id, U.owner, { type: 'accept' })).status).toBe(200)
  await pool.query('DELETE FROM notifications WHERE user_id = ANY($1)', [[U.cust, U.owner]])
  expect((await withdrawing(b.id, U.cust)).status).toBe(200)
  expect([await statusOf('requests', r.id), await statusOf('quotes', q.id)]).toEqual(['quoted', 'sent'])
  expect([...(await noticesOf(b.id)), ...(await noticesOf(b.id, U.owner))]).toEqual([]) // the customer acted: nobody is told
  const revised = await call(quotes.POST, U.owner, 'POST', { amount: 90, scope: 'Fence, smaller' }, { id: r.id })
  expect(revised.status).toBe(201)
  expect(QuoteSchema.parse(await revised.json())).toMatchObject({ version: 2, status: 'sent' })
  expect(await statusOf('quotes', q.id)).toBe('superseded')
})

const getAs = (handler: typeof bookingsRoute.GET, uid: string, query: string) =>
  handler(new Request(`http://localhost/app-api/v1/x?${query}`, { headers: { cookie: `uid=${uid}:${EMAIL(uid)}` } }), { params: Promise.resolve({}) })

it('GET /bookings/{id} answers each party with viewer and threadId, a stranger 404, and writes nothing', async () => {
  const b = await direct()
  const threadId = (await pool.query('SELECT id FROM threads WHERE booking_id = $1', [b.id])).rows[0].id
  const one = async (as: string, id = b.id) => {
    const res = await call(bookingOne.GET, as, 'GET', undefined, { id })
    return { status: res.status, body: res.status === 200 ? BookingViewSchema.parse(await res.json()) : null }
  }
  expect((await one(U.cust)).body).toMatchObject({ viewer: 'customer', threadId, booking: { id: b.id, address: { postcode: '10115' } } })
  expect((await one(U.owner)).body).toMatchObject({ viewer: 'provider', threadId, booking: { id: b.id, address: null } }) // not accepted: no address
  expect((await one(U.third)).status).toBe(404)
  expect((await one(U.cust, 'not-a-uuid')).status).toBe(404)
  // an additional task talks in its root's thread
  await pool.query("UPDATE bookings SET status = 'completed' WHERE id = $1", [b.id])
  const kid = (await pool.query("INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, amount, parent_booking_id) SELECT customer_id, provider_id, service_id, 'direct', 'declined', start_at, 60, 5, id FROM bookings WHERE id = $1 RETURNING id", [b.id])).rows[0].id
  expect((await one(U.owner, kid)).body).toMatchObject({ viewer: 'provider', threadId, booking: { parentBookingId: b.id } })
  // no writes: a lapsed proposal stays as it is and a missing thread is not created
  const late = await direct()
  await pool.query("UPDATE bookings SET answer_by = now() - interval '1 hour' WHERE id = $1", [late.id])
  await pool.query('DELETE FROM threads WHERE booking_id = $1', [late.id])
  expect((await one(U.cust, late.id)).body).toMatchObject({ viewer: 'customer', threadId: null, booking: { status: 'proposed' } })
  expect((await row(late.id)).status).toBe('proposed')
  expect((await pool.query('SELECT count(*)::int AS n FROM threads WHERE booking_id = $1', [late.id])).rows[0].n).toBe(0)
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
