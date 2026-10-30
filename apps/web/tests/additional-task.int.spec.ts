import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { asUser, db, pool } from '@kando/db'
import { BookingSchema, QuoteSchema, RequestSchema } from '@kando/contract'
import {
  cancelBooking,
  clearOutbox,
  confirmJob,
  finishJob,
  handleGatewayEvent,
  objectNoShow,
  openDispute,
  outboxForTests,
  reportNoShow,
  runDueTimers,
  setGatewayForTests,
  stopJob,
  type GatewayEvent,
} from '@kando/domain'
import { call, cleanupUsers, EMAIL, seedBase, seedProvider, seedUser } from './helpers'
import { fakeGateway, type FakeGateway } from './fake-gateway'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const startRoute = await import('../app/app-api/v1/bookings/[id]/additional-task/route')
const quoteRoute = await import('../app/app-api/v1/requests/[id]/quotes/route')
const acceptRoute = await import('../app/app-api/v1/quotes/[id]/accept/route')
const listRoute = await import('../app/app-api/v1/bookings/route')

const U = { cust: 'at-cust', owner: 'at-owner', third: 'at-third' }
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
let providerId: string
let g: FakeGateway
let slot = 0

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  await seedUser(U.cust)
  await seedUser(U.third)
  providerId = await seedProvider(U.owner, { name: 'At Owner', categoryId, price: 100 })
  await pool.query("UPDATE providers SET stripe_account_id = 'acct_at_1', payouts_ready_at = now() WHERE id = $1", [providerId])
  await pool.query("UPDATE users SET language = 'en' WHERE id = ANY($1)", [[U.cust, U.owner]]) // the texts below are checked in English
})
beforeEach(async () => {
  vi.stubEnv('PAYMENTS_ENABLED', 'true')
  g = fakeGateway()
  setGatewayForTests(g)
  clearOutbox()
  // every test sees only its own bookings in a sweep
  await pool.query("DELETE FROM notifications WHERE user_id LIKE 'at-%'")
  await pool.query("UPDATE bookings SET status = 'expired' WHERE customer_id = 'at-cust' AND status IN ('confirmed', 'finished', 'disputed', 'stopped', 'awaiting-payment')")
  await pool.query("UPDATE requests SET status = 'withdrawn' WHERE customer_id = 'at-cust' AND status IN ('open', 'quoted')")
})
afterEach(() => {
  setGatewayForTests(undefined)
  vi.unstubAllEnvs()
})
afterAll(cleanupUsers)

/** A paid root booking (as the webhook leaves it), 60 minutes on site, 100 EUR, with its charge row; `finishedAt` makes it finished. */
async function paidRoot(o: { startAt?: Date; finishedAt?: Date } = {}): Promise<{ id: string; startAt: Date }> {
  const startAt = o.startAt ?? new Date(Date.now() - 2 * HOUR - ++slot * 3 * HOUR)
  const service = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [providerId])).rows[0].id
  const id = (
    await pool.query(
      `INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, on_site, address_postcode, address_street, pay_by, paid_at, payment_ref, commission_rate, finished_at, confirm_by)
       VALUES ($1, $2, $3, 'direct', $4, $5, 60, true, '10115', 'Hauptstr. 1', $5::timestamptz - interval '2 days', $5::timestamptz - interval '2 days', 'pi_at', 0.12, $6::timestamptz, $6::timestamptz + interval '7 days') RETURNING id`,
      [U.cust, providerId, service, o.finishedAt ? 'finished' : 'confirmed', startAt, o.finishedAt ?? null],
    )
  ).rows[0].id as string
  await pool.query("INSERT INTO ledger_entries (booking_id, provider_id, kind, amount, gateway_ref, idempotency_key) VALUES ($1, $2, 'charge', 100, 'pi_at', $3)", [id, providerId, `charge:${id}`])
  return { id, startAt }
}

const start = (as: string, id: string, description = 'Noch das Gartentor streichen') => call(startRoute.POST, as, 'POST', { description }, { id })
const quote = (requestId: string, amount = 40) => call(quoteRoute.POST, U.owner, 'POST', { amount, scope: 'Gartentor streichen' }, { id: requestId })
const accept = (quoteId: string, as = U.cust, body: object = {}) => call(acceptRoute.POST, as, 'POST', body, { id: quoteId })
/** start, quote, accept: the awaiting-payment child of `parent`. */
async function childOf(parent: string, amount = 40): Promise<{ id: string; requestId: string; quoteId: string }> {
  const r = RequestSchema.parse(await (await start(U.cust, parent)).json())
  const q = QuoteSchema.parse(await (await quote(r.id, amount)).json())
  const res = await accept(q.id)
  expect(res.status).toBe(200)
  return { id: BookingSchema.parse(await res.json()).id, requestId: r.id, quoteId: q.id }
}
const paidEvent = (bookingId: string, amountCents: number): GatewayEvent => ({
  id: `evt_${randomUUID()}`,
  type: 'checkout-paid',
  bookingId,
  providerId,
  customerId: U.cust,
  sessionId: `cs_${randomUUID()}`,
  paymentRef: `pi_${randomUUID()}`,
  amountCents,
  currency: 'EUR',
})
/** A paid child (through the real start, quote, accept and webhook). */
async function paidChildOf(parent: string, amount = 40, now = new Date()): Promise<string> {
  const { id } = await childOf(parent, amount)
  await handleGatewayEvent(paidEvent(id, amount * 100), now)
  expect((await row(id)).status).toBe('confirmed')
  return id
}

const row = async (id: string) =>
  (await pool.query('SELECT status, parent_booking_id, start_at, duration_min, on_site, address_postcode, address_street, amount, pay_by, paid_at, released_at, no_show, asked_done_at, confirm_by FROM bookings WHERE id = $1', [id])).rows[0]
const ledger = async (id: string) => (await pool.query("SELECT kind, amount::float AS amount FROM ledger_entries WHERE booking_id = $1 AND kind <> 'charge' ORDER BY kind", [id])).rows
const cardsOf = async (bookingId: string) =>
  (await pool.query("SELECT m.card FROM messages m JOIN threads t ON t.id = m.thread_id WHERE t.booking_id = $1 AND m.kind = 'card' ORDER BY m.created_at", [bookingId])).rows.map((r) => r.card)
const refusal = (p: Promise<unknown>) =>
  p.then(
    () => ({ status: 0, body: null }),
    async (e: unknown) => (e instanceof Response ? { status: e.status, body: await e.json() } : Promise.reject(e)),
  )

it("either side starts an additional task; a card appears in the parent's thread", async () => {
  const root = await paidRoot()
  const res = await start(U.cust, root.id)
  expect(res.status).toBe(201)
  const r = RequestSchema.parse(await res.json())
  expect(r).toMatchObject({ customerId: U.cust, providerId, parentBookingId: root.id, status: 'open', description: 'Noch das Gartentor streichen' })
  expect(r.serviceId).toBe((await pool.query('SELECT service_id FROM bookings WHERE id = $1', [root.id])).rows[0].service_id)
  expect(await cardsOf(root.id)).toEqual([{ type: 'additional-task', refId: r.id }])
  // the provider is told
  expect((await pool.query("SELECT payload FROM notifications WHERE user_id = $1 AND kind = 'additional-task-requested'", [U.owner])).rows).toEqual([{ payload: { requestId: r.id } }])
  expect(outboxForTests().find((m) => m.to === EMAIL(U.owner))?.text).toMatch(/Please send them a quote/) // the provider must quote
  // one open additional task per booking at a time; contact details are refused
  expect((await start(U.owner, root.id)).status).toBe(409)
  expect((await start(U.cust, (await paidRoot()).id, 'Ruf mich an: 0171 2345678')).status).toBe(422)

  // the provider's "Scope/quote review" on a finished booking
  const done = await paidRoot({ finishedAt: new Date() })
  const p = await start(U.owner, done.id, 'Die Hecke muss auch geschnitten werden')
  expect(p.status).toBe(201)
  const pr = RequestSchema.parse(await p.json())
  expect(pr).toMatchObject({ customerId: U.cust, providerId, parentBookingId: done.id })
  expect(await cardsOf(done.id)).toEqual([{ type: 'additional-task', refId: pr.id }])
  expect((await pool.query("SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND kind = 'additional-task-requested'", [U.cust])).rows[0].n).toBe(1)
  expect(outboxForTests().find((m) => m.to === EMAIL(U.cust))?.text).toMatch(/The provider sends you a quote/)
})

it('accepting its quote creates an awaiting-payment child with the parent\'s time', async () => {
  const root = await paidRoot({ finishedAt: new Date() }) // its start is in the past: no time check, no slot check
  const r = RequestSchema.parse(await (await start(U.cust, root.id)).json())
  const q = QuoteSchema.parse(await (await quote(r.id, 40)).json())
  expect((await cardsOf(root.id)).at(-1)).toEqual({ type: 'additional-task', refId: q.id, amount: 40, currency: 'EUR' })
  const before = Date.now()
  const res = await accept(q.id)
  expect(res.status).toBe(200)
  const raw = await res.json()
  for (const k of ['commissionRate', 'paymentRef', 'checkoutRef', 'paidAt', 'releasedAt']) expect(raw).not.toHaveProperty(k)
  const b = BookingSchema.parse(raw)
  expect(b).toMatchObject({ parentBookingId: root.id, status: 'awaiting-payment', amount: 40, durationMin: 60, onSite: true, address: { postcode: '10115', street: 'Hauptstr. 1' } })
  expect(b.startAt).toBe(root.startAt.toISOString())
  expect(new Date(b.payBy!).getTime()).toBeGreaterThanOrEqual(before + 48 * HOUR)
  expect(new Date(b.payBy!).getTime()).toBeLessThanOrEqual(Date.now() + 48 * HOUR)
  // a second accept: a clean 409, still one child
  const again = await accept(q.id)
  expect(again.status).toBe(409)
  expect(await again.json()).toEqual({ error: 'quote-not-open' })
  expect((await pool.query('SELECT count(*)::int n FROM bookings WHERE quote_id = $1', [q.id])).rows[0].n).toBe(1)
  // listed under its parent
  const list = (await (await call(listRoute.GET, U.cust)).json()).docs as { id: string }[]
  const at = list.findIndex((x) => x.id === root.id)
  expect(list[at + 1]!.id).toBe(b.id)
})

it('a parent that stopped being open gives a clean 409 on accept', async () => {
  const root = await paidRoot()
  const r = RequestSchema.parse(await (await start(U.cust, root.id)).json())
  const q = QuoteSchema.parse(await (await quote(r.id)).json())
  await pool.query("UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [root.id])
  const res = await accept(q.id)
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'not-open' })
  expect((await pool.query('SELECT status FROM quotes WHERE id = $1', [q.id])).rows[0].status).toBe('sent')
})

it('two concurrent accepts of an additional task: one 200, one 409', async () => {
  const root = await paidRoot()
  const r = RequestSchema.parse(await (await start(U.cust, root.id)).json())
  const q = QuoteSchema.parse(await (await quote(r.id)).json())
  const holder = await pool.connect()
  let both: Promise<Response[]>
  try {
    await holder.query('BEGIN')
    await holder.query("SELECT pg_advisory_xact_lock(hashtext('booking_request'), hashtext($1))", [r.id])
    both = Promise.all([accept(q.id), accept(q.id)])
    await new Promise((ok) => setTimeout(ok, 500))
    expect((await pool.query('SELECT count(*)::int n FROM bookings WHERE quote_id = $1', [q.id])).rows[0].n).toBe(0)
    await holder.query('COMMIT')
  } finally {
    holder.release()
  }
  expect((await both).map((x) => x.status).sort()).toEqual([200, 409])
  expect((await pool.query('SELECT count(*)::int n FROM bookings WHERE quote_id = $1', [q.id])).rows[0].n).toBe(1)
})

it('an accept racing a cancel of the parent: the child never outlives the parent', async () => {
  const root = await paidRoot({ startAt: new Date(Date.now() + 5 * DAY + ++slot * 3 * HOUR) })
  const r = RequestSchema.parse(await (await start(U.cust, root.id)).json())
  const q = QuoteSchema.parse(await (await quote(r.id)).json())
  // hold the parent row: the accept queues on it first, then the cancel (whose locking read starts before the child exists)
  const holder = await pool.connect()
  let acc: Promise<Response>, cancel: Promise<unknown>
  try {
    await holder.query('BEGIN')
    await holder.query('SELECT id FROM bookings WHERE id = $1 FOR UPDATE', [root.id])
    acc = accept(q.id)
    await new Promise((ok) => setTimeout(ok, 400))
    cancel = refusal(asUser(U.cust, (tx) => cancelBooking(tx, U.cust, root.id)))
    await new Promise((ok) => setTimeout(ok, 400))
    expect((await pool.query('SELECT count(*)::int n FROM bookings WHERE quote_id = $1', [q.id])).rows[0].n).toBe(0)
    await holder.query('COMMIT')
  } finally {
    holder.release()
  }
  expect((await acc).status).toBe(200)
  await cancel
  // the cancel found the child committed while it waited: withdrawn, never left awaiting payment under a cancelled parent
  expect((await row(root.id)).status).toBe('cancelled')
  expect((await pool.query('SELECT status FROM bookings WHERE parent_booking_id = $1', [root.id])).rows).toEqual([{ status: 'withdrawn' }])})

it('the child is paid, finished and released on its own clock', async () => {
  const root = await paidRoot()
  const now = new Date()
  const child = await paidChildOf(root.id, 40, now) // the parent's slot does not block its own additional task
  expect(await row(child)).toMatchObject({ status: 'confirmed', parent_booking_id: root.id })
  // the customer cannot finish; the provider finishes the child only
  expect(await refusal(asUser(U.cust, (tx) => finishJob(tx, U.cust, child, {}, now)))).toEqual({ status: 403, body: { error: 'not-your-turn' } })
  await asUser(U.owner, (tx) => finishJob(tx, U.owner, child, {}, now))
  expect((await row(child)).status).toBe('finished')
  expect((await row(root.id)).status).toBe('confirmed')
  // 7 days later the child alone is paid out: 40 minus 12% commission, nothing refunded
  await runDueTimers(db, new Date(now.getTime() + 7 * DAY + MIN))
  expect(await row(child)).toMatchObject({ status: 'completed' })
  expect((await row(child)).released_at).not.toBeNull()
  expect(await ledger(child)).toEqual([
    { kind: 'commission', amount: 4.8 },
    { kind: 'transfer', amount: 35.2 },
  ])
  expect((await row(root.id)).released_at).toBeNull()
  expect(await ledger(root.id)).toEqual([])
})

it("the silent-provider clock of a child starts at its payment, not at the parent's past start", async () => {
  const root = await paidRoot({ startAt: new Date(Date.now() - 3 * DAY) })
  const now = new Date()
  const child = await paidChildOf(root.id, 40, now)
  await runDueTimers(db, new Date(now.getTime() + 2 * HOUR))
  expect((await row(child)).asked_done_at).toBeNull() // the parent's end + 24 hours has long passed: not the child's clock
  await runDueTimers(db, new Date(now.getTime() + 24 * HOUR + MIN))
  expect((await row(child)).asked_done_at).not.toBeNull()
  expect((await pool.query('SELECT count(*)::int n FROM disputes WHERE booking_id = $1', [child])).rows[0].n).toBe(0)
})

it("a no-show on a child counts from its payment, not from the parent's past start", async () => {
  const root = await paidRoot({ startAt: new Date(Date.now() - 3 * DAY) })
  const paidAt = new Date(Date.now() + HOUR)
  const child = await paidChildOf(root.id, 40, paidAt)
  expect(await refusal(asUser(U.owner, (tx) => reportNoShow(tx, U.owner, child, new Date(paidAt.getTime() - MIN))))).toEqual({ status: 409, body: { error: 'TOO_EARLY' } })
  await asUser(U.owner, (tx) => reportNoShow(tx, U.owner, child, new Date(paidAt.getTime() + MIN)))
  expect((await row(child)).no_show).toBe('customer')
})

it('a dispute on the child freezes only the child', async () => {
  const root = await paidRoot()
  const now = new Date()
  const child = await paidChildOf(root.id, 40, now)
  await asUser(U.owner, (tx) => finishJob(tx, U.owner, root.id, {}, now))
  await asUser(U.owner, (tx) => finishJob(tx, U.owner, child, {}, now))
  await asUser(U.cust, (tx) => openDispute(tx, U.cust, child, { description: 'Das Tor ist nur halb gestrichen.' }, new Date(now.getTime() + DAY)))
  await runDueTimers(db, new Date(now.getTime() + 7 * DAY + MIN))
  expect((await row(root.id)).status).toBe('completed')
  expect(await ledger(root.id)).toEqual([
    { kind: 'commission', amount: 12 },
    { kind: 'transfer', amount: 88 },
  ])
  expect(await row(child)).toMatchObject({ status: 'disputed', released_at: null })
  expect(await ledger(child)).toEqual([])
})

it('a dispute on the root does not hold up its finished additional task', async () => {
  const root = await paidRoot()
  const now = new Date()
  const child = await paidChildOf(root.id, 40, now)
  await asUser(U.owner, (tx) => finishJob(tx, U.owner, root.id, {}, now))
  await asUser(U.owner, (tx) => finishJob(tx, U.owner, child, {}, now))
  await asUser(U.cust, (tx) => openDispute(tx, U.cust, root.id, { description: 'Der Zaun wackelt.' }, new Date(now.getTime() + DAY)))
  await runDueTimers(db, new Date(now.getTime() + 7 * DAY + MIN))
  // paid out independently (spec 3.12): the root waits for staff, the undisputed child is released on its own clock
  expect(await row(root.id)).toMatchObject({ status: 'disputed', released_at: null })
  expect(await ledger(root.id)).toEqual([])
  expect((await row(child)).status).toBe('completed')
  expect(await ledger(child)).toEqual([
    { kind: 'commission', amount: 4.8 },
    { kind: 'transfer', amount: 35.2 },
  ])
})

it('a chargeback flag on the root does not hold up its additional task, one on the child does', async () => {
  const root = await paidRoot()
  const now = new Date()
  const child = await paidChildOf(root.id, 40, now)
  await asUser(U.owner, (tx) => finishJob(tx, U.owner, child, {}, now))
  await pool.query("INSERT INTO staff_flags (kind, ref_id, user_id, note) VALUES ('chargeback', $1, $2, 'test')", [root.id, U.cust])
  await runDueTimers(db, new Date(now.getTime() + 7 * DAY + MIN))
  expect((await row(child)).status).toBe('completed')
  const other = await paidChildOf((await paidRoot()).id, 40, now)
  await asUser(U.owner, (tx) => finishJob(tx, U.owner, other, {}, now))
  await pool.query("INSERT INTO staff_flags (kind, ref_id, user_id, note) VALUES ('chargeback', $1, $2, 'test')", [other, U.cust])
  await runDueTimers(db, new Date(now.getTime() + 7 * DAY + MIN))
  expect(await row(other)).toMatchObject({ status: 'finished', released_at: null })
})

it('an expired additional-task request sends no "try another provider" message', async () => {
  const root = await paidRoot()
  const r = RequestSchema.parse(await (await start(U.cust, root.id)).json())
  await runDueTimers(db, new Date(Date.now() + 4 * DAY))
  expect((await pool.query('SELECT status FROM requests WHERE id = $1', [r.id])).rows[0].status).toBe('expired')
  expect((await pool.query("SELECT count(*)::int n FROM notifications WHERE kind = 'request-expired' AND payload->>'requestId' = $1", [r.id])).rows[0].n).toBe(0)
})

it("a root's provider no-show covers its paid additional task: never finished or paid out, refunded with the root", async () => {
  const root = await paidRoot()
  const now = new Date()
  const child = await paidChildOf(root.id, 40, now)
  const unpaid = (await childOf((await paidRoot()).id)).id // another booking's: untouched
  const pending = await (async () => {
    // a second additional task of the root, still unpaid
    await pool.query("UPDATE requests SET status = 'withdrawn' WHERE parent_booking_id = $1 AND status IN ('open', 'quoted')", [root.id])
    return (await childOf(root.id, 30)).id
  })()
  await asUser(U.cust, (tx) => reportNoShow(tx, U.cust, root.id, now))
  expect(await row(child)).toMatchObject({ status: 'confirmed', no_show: 'provider' })
  // frozen with the root: no Finished, no stop, no cancel, no objection on the child alone
  const later = new Date(now.getTime() + HOUR)
  expect(await refusal(asUser(U.owner, (tx) => finishJob(tx, U.owner, child, {}, later)))).toEqual({ status: 409, body: { error: 'NO_SHOW_REPORTED' } })
  expect(await refusal(asUser(U.owner, (tx) => stopJob(tx, U.owner, child, later)))).toEqual({ status: 409, body: { error: 'NO_SHOW_REPORTED' } })
  expect(await refusal(asUser(U.cust, (tx) => confirmJob(tx, U.cust, child, later)))).toEqual({ status: 409, body: { error: 'not-open' } })
  expect((await refusal(asUser(U.owner, (tx) => objectNoShow(tx, U.owner, child, { description: 'Ich war da.' }, later)))).status).toBe(409)
  // a payment for the unpaid one now is refunded, not confirmed
  await handleGatewayEvent(paidEvent(pending, 3000), later)
  expect((await row(pending)).status).toBe('awaiting-payment')
  expect(g.calls.filter((c) => c.method === 'refund')).toHaveLength(1)
  // 48 hours without objection: root and child cancelled and refunded in full, nothing transferred
  await runDueTimers(db, new Date(now.getTime() + 48 * HOUR + MIN))
  expect(await row(root.id)).toMatchObject({ status: 'cancelled', no_show: 'provider' })
  expect(await row(child)).toMatchObject({ status: 'cancelled', no_show: 'provider' })
  expect((await row(child)).released_at).not.toBeNull()
  expect(await ledger(child)).toEqual([{ kind: 'refund', amount: 40 }])
  expect(await ledger(root.id)).toEqual([{ kind: 'refund', amount: 100 }])
  expect((await row(pending)).status).toBe('withdrawn')
  expect((await row(unpaid)).status).toBe('awaiting-payment')
  expect(g.calls.filter((c) => c.method === 'transfer')).toEqual([])
  // one reliability count for the provider (roots only)
  expect((await pool.query('SELECT provider_reliability($1) n', [providerId])).rows[0].n).toBe(1)
})

it("a root's customer no-show pays its paid additional task to the provider", async () => {
  const root = await paidRoot()
  const now = new Date()
  const child = await paidChildOf(root.id, 40, now)
  await asUser(U.owner, (tx) => reportNoShow(tx, U.owner, root.id, now))
  expect((await row(child)).no_show).toBe('customer')
  await runDueTimers(db, new Date(now.getTime() + 48 * HOUR + MIN))
  expect(await row(child)).toMatchObject({ status: 'cancelled', no_show: 'customer' })
  expect(await ledger(child)).toEqual([
    { kind: 'commission', amount: 4.8 },
    { kind: 'transfer', amount: 35.2 },
  ])
})

it("an objection to the root's no-show freezes its additional tasks too", async () => {
  const root = await paidRoot()
  const now = new Date()
  const child = await paidChildOf(root.id, 40, now)
  await asUser(U.cust, (tx) => reportNoShow(tx, U.cust, root.id, now))
  await asUser(U.owner, (tx) => objectNoShow(tx, U.owner, root.id, { description: 'Ich war pünktlich da.' }, new Date(now.getTime() + HOUR)))
  expect((await row(root.id)).status).toBe('disputed')
  await runDueTimers(db, new Date(now.getTime() + 9 * DAY))
  expect(await row(child)).toMatchObject({ status: 'confirmed', no_show: 'provider', released_at: null })
  expect(await ledger(child)).toEqual([])
  expect(await refusal(asUser(U.owner, (tx) => finishJob(tx, U.owner, child, {}, new Date(now.getTime() + 9 * DAY))))).toEqual({ status: 409, body: { error: 'NO_SHOW_REPORTED' } })
  expect((await pool.query('SELECT count(*)::int n FROM disputes WHERE booking_id = $1', [child])).rows[0].n).toBe(0) // no separate no-response dispute
})

it('an additional task on a cancelled booking is 409', async () => {
  const root = await paidRoot()
  await pool.query("UPDATE bookings SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [root.id])
  expect((await start(U.cust, root.id)).status).toBe(409)
  // nor on an unpaid booking, nor on an additional task itself, nor with a reported no-show
  const open = await paidRoot()
  const child = await childOf(open.id)
  expect((await start(U.cust, child.id)).status).toBe(409)
  await pool.query("UPDATE bookings SET status = 'awaiting-payment', accepted_at = now() WHERE id = $1", [open.id])
  expect((await start(U.cust, open.id)).status).toBe(409)
  const reported = await paidRoot()
  await asUser(U.cust, (tx) => reportNoShow(tx, U.cust, reported.id, new Date()))
  expect((await start(U.owner, reported.id)).status).toBe(409)
  expect((await pool.query('SELECT count(*)::int n FROM requests WHERE parent_booking_id = ANY($1)', [[root.id, child.id, reported.id]])).rows[0].n).toBe(0)
})

it('a third user gets 404', async () => {
  const root = await paidRoot()
  expect((await start(U.third, root.id)).status).toBe(404)
  expect((await start(U.third, randomUUID())).status).toBe(404)
  const r = RequestSchema.parse(await (await start(U.cust, root.id)).json())
  expect((await call(quoteRoute.POST, U.third, 'POST', { amount: 10, scope: 'x' }, { id: r.id })).status).toBe(404)
  expect((await call(quoteRoute.POST, U.cust, 'POST', { amount: 10, scope: 'x' }, { id: r.id })).status).toBe(404) // the customer cannot quote
  const q = QuoteSchema.parse(await (await quote(r.id)).json())
  expect((await accept(q.id, U.third)).status).toBe(404)
  expect((await accept(q.id, U.owner)).status).toBe(404) // the provider cannot accept their own quote
  expect((await pool.query('SELECT count(*)::int n FROM bookings WHERE parent_booking_id = $1', [root.id])).rows[0].n).toBe(0)
})
