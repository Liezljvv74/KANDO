import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { asUser, db, pool } from '@kando/db'
import { BookingViewSchema, RequestSchema } from '@kando/contract'
import { cancelBooking, clearOutbox, createPayLink, runDueTimers } from '@kando/domain'
import { setGatewayForTests } from '@kando/domain/src/testing'
import { call, cleanupUsers, makeAwaitingPayment, makeQuote, seedBase, seedProvider, seedUser } from './helpers'
import { fakeGateway, type FakeGateway } from './fake-gateway'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const bookingOne = await import('../app/app-api/v1/bookings/[id]/route')
const requestOne = await import('../app/app-api/v1/requests/[id]/route')
const requestList = await import('../app/app-api/v1/requests/route')

const U = { cust: 'js-cust', owner: 'js-owner' }
const HOUR = 3_600_000
const DAY = 24 * HOUR
let providerId: string, serviceId: string
let g: FakeGateway
let slot = 0
const day = (n: number) => new Date(Date.now() + n * DAY).toISOString()

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  await seedUser(U.cust)
  providerId = await seedProvider(U.owner, { name: 'Js Owner', categoryId, price: 100 })
  serviceId = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [providerId])).rows[0].id
  await pool.query("UPDATE providers SET stripe_account_id = 'acct_js_1', payouts_ready_at = now(), invoice_consent_at = now() WHERE id = $1", [providerId])
})
beforeEach(() => {
  vi.stubEnv('PAYMENTS_ENABLED', 'true')
  g = fakeGateway()
  setGatewayForTests(g)
  clearOutbox()
})
afterEach(() => {
  setGatewayForTests(undefined)
  vi.unstubAllEnvs()
})
afterAll(cleanupUsers)

const view = async (uid: string, id: string) => BookingViewSchema.parse(await (await call(bookingOne.GET, uid, 'GET', undefined, { id })).json())
const stateOf = async (uid: string, id: string) => (await view(uid, id)).booking.jobState!
const flag = (kind: string, ref: string, note: string | null, resolved = false) =>
  pool.query(`INSERT INTO staff_flags (kind, ref_id, user_id, note, resolved_at) VALUES ($1, $2, $3, $4, ${resolved ? 'now()' : 'NULL'})`, [kind, ref, U.cust, note])

/** A paid, confirmed booking (as the webhook leaves it), 100 EUR, with its charge row. */
async function paidBooking(o: { startAt?: Date; status?: string } = {}): Promise<string> {
  const startAt = o.startAt ?? new Date(Date.now() + 3 * DAY + ++slot * 3 * HOUR)
  const id = (
    await pool.query(
      `INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, pay_by, paid_at, payment_ref, commission_rate)
       VALUES ($1, $2, $3, 'direct', $4, $5, 60, $5::timestamptz - interval '2 days', $5::timestamptz - interval '2 days', 'pi_js_' || gen_random_uuid(), 0.12) RETURNING id`,
      [U.cust, providerId, serviceId, o.status ?? 'confirmed', startAt],
    )
  ).rows[0].id as string
  await pool.query("INSERT INTO ledger_entries (booking_id, provider_id, kind, amount, idempotency_key) VALUES ($1, $2, 'charge', 100, $3)", [id, providerId, `charge:${id}`])
  return id
}

it('GET a booking returns jobState for the caller, and the old fields unchanged', async () => {
  const b = await makeAwaitingPayment({ customerId: U.cust, ownerId: U.owner, providerId, startAt: day(20) })
  const cust = await view(U.cust, b.id)
  expect(cust.booking.jobState).toMatchObject({ key: 'payment_due', section: 'needs_you', buttons: ['pay'], countsForMe: true })
  expect(await stateOf(U.owner, b.id)).toMatchObject({ key: 'payment_due', section: 'active', buttons: [] })
  expect(cust.booking).toMatchObject({ status: 'awaiting-payment', payBy: expect.any(String), amount: 100, currency: 'EUR' })
  expect(cust.booking).not.toHaveProperty('commissionRate')
  expect(cust.booking).not.toHaveProperty('checkoutRef')
})

it('a checkout reference older than the patience reads checkout_not_completed; one without a start time stays payment_due', async () => {
  const b = await makeAwaitingPayment({ customerId: U.cust, ownerId: U.owner, providerId, startAt: day(21) })
  const set = (ref: object) => pool.query('UPDATE bookings SET checkout_ref = $2 WHERE id = $1', [b.id, JSON.stringify(ref)])
  await set({ sessionId: 'cs_1', url: 'https://x', expiresAt: new Date(Date.now() + DAY).toISOString() })
  expect((await stateOf(U.cust, b.id)).key).toBe('payment_due')
  await set({ sessionId: 'cs_1', url: 'https://x', expiresAt: new Date(Date.now() + DAY).toISOString(), startedAt: new Date(Date.now() - 11 * 60_000).toISOString() })
  expect(await stateOf(U.cust, b.id)).toMatchObject({ key: 'checkout_not_completed', buttons: ['pay'] })
  expect((await stateOf(U.owner, b.id)).buttons).toEqual([])
})

it('a repeated pay tap reuses the session and restarts the wait: payment_due, not checkout_not_completed; an expired session still is', async () => {
  const b = await makeAwaitingPayment({ customerId: U.cust, ownerId: U.owner, providerId, startAt: day(23) })
  const first = await createPayLink(db, U.cust, b.id, new Date(Date.now() - 30 * 60_000))
  expect((await stateOf(U.cust, b.id)).key).toBe('checkout_not_completed') // 30 minutes after the first tap
  const second = await createPayLink(db, U.cust, b.id, new Date())
  expect(second.url).toBe(first.url)
  expect(g.attempts.createCheckout).toBe(1) // reused
  const ref = JSON.parse((await pool.query('SELECT checkout_ref FROM bookings WHERE id = $1', [b.id])).rows[0].checkout_ref)
  expect(ref).toMatchObject({ sessionId: expect.any(String), url: first.url, expiresAt: expect.any(String) })
  expect(Date.now() - Date.parse(ref.startedAt)).toBeLessThan(60_000)
  expect(await stateOf(U.cust, b.id)).toMatchObject({ key: 'payment_due', buttons: ['pay'] })
  await pool.query('UPDATE bookings SET checkout_ref = $2 WHERE id = $1', [b.id, JSON.stringify({ ...ref, expiresAt: new Date(Date.now() - 1000).toISOString() })])
  expect((await stateOf(U.cust, b.id)).key).toBe('checkout_not_completed')
})

it('GET a request and the request list return jobState for each side', async () => {
  const { request } = await makeQuote({ customerId: U.cust, ownerId: U.owner, providerId, startAt: day(22) })
  const one = async (uid: string) => RequestSchema.parse(await (await call(requestOne.GET, uid, 'GET', undefined, { id: request.id })).json())
  expect((await one(U.cust)).jobState).toMatchObject({ key: 'quote_sent', section: 'needs_you', buttons: ['accept_quote', 'ask_question', 'open_chat'] })
  expect((await one(U.owner)).jobState).toMatchObject({ key: 'quote_sent', section: 'active', buttons: ['open_chat'] })
  const list = (await (await call(requestList.GET, U.cust)).json()) as { docs: { id: string; jobState?: { key: string } }[] }
  expect(list.docs.find((r) => r.id === request.id)?.jobState?.key).toBe('quote_sent')
})

it('an unseen message notice makes the job count for the viewer; seen, it does not', async () => {
  const b = await paidBooking()
  expect(await stateOf(U.cust, b)).toMatchObject({ key: 'paid_upcoming', section: 'active', countsForMe: false })
  const thread = (await pool.query('INSERT INTO threads (booking_id, customer_id, provider_id) VALUES ($1, $2, $3) RETURNING id', [b, U.cust, providerId])).rows[0].id
  await pool.query("INSERT INTO notifications (user_id, kind, payload) VALUES ($1, 'message-received', $2)", [U.cust, JSON.stringify({ threadId: thread })])
  expect(await stateOf(U.cust, b)).toMatchObject({ key: 'paid_upcoming', section: 'needs_you', countsForMe: true })
  expect(await stateOf(U.owner, b)).toMatchObject({ section: 'active', countsForMe: false }) // the notice is the customer's
  await pool.query("UPDATE notifications SET seen_at = now() WHERE user_id = $1 AND payload->>'threadId' = $2", [U.cust, thread])
  expect(await stateOf(U.cust, b)).toMatchObject({ section: 'active', countsForMe: false })
})

it('an unseen notice in the root job chat marks the root request, the root booking, and an additional task (it talks in the root chat)', async () => {
  const root = await makeAwaitingPayment({ customerId: U.cust, ownerId: U.owner, providerId, startAt: day(19) })
  const thread = (await pool.query('INSERT INTO threads (request_id, customer_id, provider_id) VALUES ($1, $2, $3) ON CONFLICT (request_id) DO UPDATE SET customer_id = threads.customer_id RETURNING id', [root.requestId, U.cust, providerId])).rows[0].id
  await pool.query("UPDATE bookings SET status = 'confirmed', paid_at = now(), payment_ref = 'pi_js_x', commission_rate = 0.12 WHERE id = $1", [root.id])
  const taskReq = (await pool.query("INSERT INTO requests (customer_id, provider_id, service_id, description, answer_by, parent_booking_id) VALUES ($1, $2, $3, 'Noch ein Tor', now() + interval '3 days', $4) RETURNING id", [U.cust, providerId, serviceId, root.id])).rows[0].id
  const quote = (await pool.query("INSERT INTO quotes (request_id, provider_id, amount, scope, expires_at, status) VALUES ($1, $2, 20, 'Tor', now() + interval '7 days', 'accepted') RETURNING id", [taskReq, providerId])).rows[0].id
  const task = (await pool.query("INSERT INTO bookings (customer_id, provider_id, quote_id, source, status, start_at, duration_min, parent_booking_id, pay_by, accepted_at) VALUES ($1, $2, $3, 'quote', 'awaiting-payment', $4, 60, $5, now() + interval '2 days', now()) RETURNING id", [U.cust, providerId, quote, day(19), root.id])).rows[0].id as string
  await pool.query("UPDATE bookings SET status = 'confirmed', paid_at = now(), payment_ref = 'pi_js_y', commission_rate = 0.12 WHERE id = $1", [task])
  const counts = async () => ({
    root: (await stateOf(U.cust, root.id)).countsForMe,
    task: (await stateOf(U.cust, task)).countsForMe,
    request: RequestSchema.parse(await (await call(requestOne.GET, U.cust, 'GET', undefined, { id: root.requestId! })).json()).jobState!.countsForMe,
    taskRequest: RequestSchema.parse(await (await call(requestOne.GET, U.cust, 'GET', undefined, { id: taskReq })).json()).jobState!.countsForMe,
  })
  expect(await counts()).toMatchObject({ root: false, task: false })
  await pool.query("INSERT INTO notifications (user_id, kind, payload) VALUES ($1, 'message-received', $2)", [U.cust, JSON.stringify({ threadId: thread })])
  expect(await counts()).toEqual({ root: true, task: true, request: true, taskRequest: true })
  await pool.query("UPDATE notifications SET seen_at = now() WHERE user_id = $1 AND payload->>'threadId' = $2", [U.cust, thread])
  expect(await counts()).toEqual({ root: false, task: false, request: false, taskRequest: false })
})

it('jobState is sent on reads and not on a mutation response', async () => {
  const b = await makeAwaitingPayment({ customerId: U.cust, ownerId: U.owner, providerId, startAt: day(18) })
  const withdraw = await import('../app/app-api/v1/bookings/[id]/withdraw/route')
  const list = (await (await call((await import('../app/app-api/v1/bookings/route')).GET, U.cust)).json()) as { docs: { id: string; jobState?: unknown }[] }
  expect(list.docs.find((x) => x.id === b.id)?.jobState).toBeTruthy()
  expect((await view(U.cust, b.id)).booking.jobState).toBeTruthy()
  const res = (await (await call(withdraw.POST, U.cust, 'POST', undefined, { id: b.id })).json()) as { status: string; jobState?: unknown }
  expect(res.status).toBe('withdrawn')
  expect(res.jobState).toBeUndefined()
})

it('an open release-failed flag is delayed for both sides; once resolved it is not', async () => {
  const b = await paidBooking({ status: 'completed' })
  expect(await stateOf(U.cust, b)).toMatchObject({ key: 'payout_on_its_way' })
  await flag('payment-unprocessed', b, 'release failed: NO_PAYOUT_ACCOUNT')
  for (const uid of [U.cust, U.owner]) expect(await stateOf(uid, b)).toMatchObject({ key: 'delayed', section: 'active', tone: 'bad', buttons: ['contact_support'] })
  const body = JSON.stringify(await (await call(bookingOne.GET, U.cust, 'GET', undefined, { id: b })).json())
  expect(body).not.toContain('NO_PAYOUT_ACCOUNT') // the flag text never leaves the server
  await pool.query("UPDATE staff_flags SET resolved_at = now() WHERE ref_id = $1", [b])
  expect((await stateOf(U.cust, b)).key).toBe('payout_on_its_way')
})

it('a refund-failed flag on a cancelled booking is delayed for both sides', async () => {
  const b = await paidBooking({ status: 'cancelled' })
  expect((await stateOf(U.cust, b)).key).toBe('cancelled')
  await flag('refund-failed', b, 'refund failed')
  for (const uid of [U.cust, U.owner]) expect((await stateOf(uid, b)).key).toBe('delayed')
})

it('a cancellation whose refund fails is delayed; the retry that succeeds counts once and clears it', async () => {
  const now = new Date()
  const id = await paidBooking({ startAt: new Date(now.getTime() + 25 * HOUR) })
  const refund = g.refund
  g.refund = async () => {
    throw new Error('gateway down')
  }
  await asUser(U.cust, (tx) => cancelBooking(tx, U.cust, id, now))
  for (const uid of [U.cust, U.owner]) expect((await stateOf(uid, id)).key).toBe('delayed')
  g.refund = refund
  expect((await runDueTimers(db, new Date(now.getTime() + HOUR))).cancelsSettled).toBeGreaterThanOrEqual(1)
  for (const uid of [U.cust, U.owner]) expect(await stateOf(uid, id)).toMatchObject({ key: 'cancelled', section: 'past', buttons: ['open_chat'] })
  expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE booking_id = $1 AND kind = 'refund'", [id])).rows[0].n).toBe(1)
})
