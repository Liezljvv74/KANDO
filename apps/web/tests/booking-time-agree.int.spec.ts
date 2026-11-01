import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { db, pool } from '@kando/db'
import { BookingSchema, QuoteSchema, RequestSchema } from '@kando/contract'
import { createPayLink, runDueTimers } from '@kando/domain'
import { call, cleanupUsers, relaxLimits, requestTime, seedBase, seedProvider, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const requests = await import('../app/app-api/v1/requests/route')
const quotes = await import('../app/app-api/v1/requests/[id]/quotes/route')
const confirm = await import('../app/app-api/v1/quotes/[id]/confirm/route')
const propose = await import('../app/app-api/v1/bookings/[id]/time/route')
const agree = await import('../app/app-api/v1/bookings/[id]/time/confirm/route')
const withdraw = await import('../app/app-api/v1/bookings/[id]/withdraw/route')

const U = { cust: 'ta-cust', cust2: 'ta-cust2', owner: 'ta-owner', third: 'ta-third' }
let pOwner: string
beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  for (const u of [U.cust, U.cust2, U.third]) await seedUser(u)
  pOwner = await seedProvider(U.owner, { name: 'Ta Owner', categoryId })
})
afterAll(cleanupUsers)

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()
let next = 200
const fresh = () => day(next++)
/** A booking that waits for its time: request, quote without a time, customer's confirm. */
const waiting = async (as = U.cust, startAt = fresh()) => {
  await relaxLimits(as)
  const r = RequestSchema.parse(await (await call(requests.POST, as, 'POST', { providerId: pOwner, description: 'Fix the fence', ...requestTime(), startAt })).json())
  const q = QuoteSchema.parse(await (await call(quotes.POST, U.owner, 'POST', { amount: 150, scope: 'Fence' }, { id: r.id })).json())
  return BookingSchema.parse(await (await call(confirm.POST, as, 'POST', {}, { id: q.id })).json())
}
const enter = (id: string, as: string, startAt = fresh(), extra: object = {}) => call(propose.POST, as, 'POST', { startAt, durationMin: 120, onSite: true, ...extra }, { id })
const agreeing = (id: string, as: string) => call(agree.POST, as, 'POST', {}, { id })
const row = async (id: string) => (await pool.query('SELECT * FROM bookings WHERE id = $1', [id])).rows[0]
const notices = async (user: string, kind: string) => (await pool.query('SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND kind = $2', [user, kind])).rows[0].n

it('the provider enters a time, the customer confirms it: the booking awaits payment at that time', async () => {
  const b = await waiting()
  const when = fresh()
  const before = await notices(U.cust, 'time-to-confirm')
  const dueBefore = await notices(U.cust, 'booking-accepted')
  const e = await enter(b.id, U.owner, when)
  expect(e.status).toBe(200)
  expect(BookingSchema.parse(await e.json()).pendingTime).toMatchObject({ by: 'provider', durationMin: 120, onSite: true }) // the app can show what is waiting for an answer
  expect(await notices(U.cust, 'time-to-confirm')).toBe(before + 1)
  expect((await row(b.id)).status).toBe('awaiting-time') // nothing is held yet
  const c = await agreeing(b.id, U.cust)
  expect(c.status).toBe(200)
  const done = BookingSchema.parse(await c.json())
  expect(await notices(U.cust, 'booking-accepted')).toBe(dueBefore + 1) // the customer confirmed last and still gets "Payment due"
  expect(done.status).toBe('awaiting-payment')
  expect(done.pendingTime ?? null).toBeNull()
  expect(new Date(done.startAt).getTime()).toBe(new Date(when).getTime())
  expect(done.payBy).not.toBeNull()
  const r = await row(b.id)
  expect([r.time_proposed_by, r.time_proposed_start_at, r.answer_by]).toEqual([null, null, null])
})

it('the customer enters a time, the provider confirms and the customer is told to pay', async () => {
  const b = await waiting()
  expect((await enter(b.id, U.cust)).status).toBe(200)
  const before = await notices(U.cust, 'booking-accepted')
  expect((await agreeing(b.id, U.owner)).status).toBe(200)
  expect(await notices(U.cust, 'booking-accepted')).toBe(before + 1) // "Payment due"
})

it('the one who entered the time cannot confirm it; nothing pending is a 409; a stranger gets 404; a past time is refused', async () => {
  const b = await waiting()
  const none = await agreeing(b.id, U.cust)
  expect([none.status, (await none.json()).error]).toEqual([409, 'not-open'])
  await enter(b.id, U.cust)
  expect((await agreeing(b.id, U.cust)).status).toBe(403)
  expect((await enter(b.id, U.third)).status).toBe(404)
  expect((await agreeing(b.id, U.third)).status).toBe(404)
  expect((await enter(b.id, U.owner, day(-1))).status).toBe(400)
})

it('a pending time falls away after 2 days', async () => {
  const b = await waiting()
  await enter(b.id, U.owner)
  await pool.query("UPDATE bookings SET time_answer_by = now() - interval '1 minute' WHERE id = $1", [b.id])
  const c = await agreeing(b.id, U.cust)
  expect([c.status, (await c.json()).error]).toEqual([409, 'not-open'])
  expect((await enter(b.id, U.cust)).status).toBe(200) // a new entry starts again
})

it('a time taken by someone else meanwhile is refused at confirm (409) and the booking keeps waiting', async () => {
  const when = fresh()
  const a = await waiting(U.cust)
  const b = await waiting(U.cust2)
  await enter(a.id, U.owner, when)
  await enter(b.id, U.owner, when)
  expect((await agreeing(a.id, U.cust)).status).toBe(200)
  const second = await agreeing(b.id, U.cust2)
  expect([second.status, (await second.json()).error]).toEqual([409, 'slot-pending'])
  expect((await row(b.id)).status).toBe('awaiting-time')
})

it('after 7 days without a time the booking expires, the job reads open again, and a second run does nothing', async () => {
  const b = await waiting()
  await pool.query("UPDATE bookings SET answer_by = now() - interval '1 minute' WHERE id = $1", [b.id])
  await runDueTimers(db, new Date())
  const r = await row(b.id)
  expect(r.status).toBe('expired')
  expect((await pool.query('SELECT r.status rs, q.status qs FROM requests r JOIN quotes q ON q.id = $2 WHERE r.id = $1', [r.request_id, r.quote_id])).rows[0]).toEqual({ rs: 'quoted', qs: 'sent' }) // the quote is open again for another try
  const n = await notices(U.owner, 'booking-expired')
  await runDueTimers(db, new Date())
  expect(await notices(U.owner, 'booking-expired')).toBe(n)
  expect((await enter(b.id, U.owner)).status).toBe(409)
})

it('the customer can withdraw while waiting for a time', async () => {
  const b = await waiting()
  const w = await call(withdraw.POST, U.cust, 'POST', {}, { id: b.id })
  expect([w.status, (await row(b.id)).status]).toEqual([200, 'withdrawn'])
})

it('a quote without a time, confirmed after the request time has passed, gets a future stand-in time', async () => {
  await relaxLimits(U.cust)
  const r = RequestSchema.parse(await (await call(requests.POST, U.cust, 'POST', { providerId: pOwner, description: 'Old one', ...requestTime(), startAt: fresh() })).json())
  const q = QuoteSchema.parse(await (await call(quotes.POST, U.owner, 'POST', { amount: 99, scope: 'x' }, { id: r.id })).json())
  await pool.query("UPDATE requests SET start_at = now() - interval '1 day' WHERE id = $1", [r.id])
  const b = BookingSchema.parse(await (await call(confirm.POST, U.cust, 'POST', {}, { id: q.id })).json())
  expect(new Date(b.startAt).getTime()).toBeGreaterThan(Date.now())
})

it('payment is only possible once both sides have confirmed the time: no pay link while waiting or while a time is pending', async () => {
  const b = await waiting()
  await expect(createPayLink(db, U.cust, b.id)).rejects.toMatchObject({ status: 409 })
  await enter(b.id, U.owner)
  await expect(createPayLink(db, U.cust, b.id)).rejects.toMatchObject({ status: 409 }) // entered by one side only
  const r = await row(b.id)
  expect(r.pay_by).toBeNull()
})

it('both sides have 2 days: a time entered late moves the booking deadline out, so the other side still has the full 2 days', async () => {
  const b = await waiting()
  await pool.query("UPDATE bookings SET answer_by = now() + interval '1 day' WHERE id = $1", [b.id]) // 1 day left of the 7
  expect((await enter(b.id, U.owner)).status).toBe(200)
  const r = await row(b.id)
  const left = (d: Date) => d.getTime() - Date.now()
  expect(left(r.time_answer_by)).toBeGreaterThan(1.99 * 86_400_000)
  expect(left(r.time_answer_by)).toBeLessThan(2.01 * 86_400_000)
  expect(left(r.answer_by)).toBeGreaterThanOrEqual(left(r.time_answer_by) - 1000)
  expect((await agreeing(b.id, U.cust)).status).toBe(200)
})

it('a time cannot be confirmed after the booking deadline, and a remote job cannot become on-site', async () => {
  const b = await waiting()
  await enter(b.id, U.owner)
  await pool.query("UPDATE bookings SET answer_by = now() - interval '1 minute' WHERE id = $1", [b.id])
  const late = await agreeing(b.id, U.cust)
  expect([late.status, (await late.json()).error]).toEqual([409, 'not-open'])
  const c = await waiting()
  await pool.query('UPDATE bookings SET address_postcode = NULL, address_street = NULL, address_city = NULL, on_site = false WHERE id = $1', [c.id])
  const flip = await enter(c.id, U.owner)
  expect([flip.status, (await flip.json()).error]).toEqual([400, 'address-required'])
})

it('a blocked customer cannot confirm', async () => {
  const b = await waiting()
  await enter(b.id, U.owner)
  await pool.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2)', [U.owner, U.cust])
  expect((await agreeing(b.id, U.cust)).status).toBe(403)
  await pool.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2',[U.owner, U.cust])
})
