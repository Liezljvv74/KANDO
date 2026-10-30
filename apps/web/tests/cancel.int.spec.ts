import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { asUser, db, pool } from '@kando/db'
import { cancelBooking, clearOutbox, confirmJob, finishJob, getPublicProfile, objectNoShow, reportNoShow, runDueTimers, slotIsHeld } from '@kando/domain'
import { outboxForTests, setGatewayForTests } from '@kando/domain/src/testing'
import { call, cleanupUsers, EMAIL, seedBase, seedProvider, seedUser } from './helpers'
import { appConnectionsAtMoneyCalls, fakeGateway, type FakeGateway } from './fake-gateway'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const cancelRoute = await import('../app/app-api/v1/bookings/[id]/cancel/route')
const noShowRoute = await import('../app/app-api/v1/bookings/[id]/no-show/route')
const objectRoute = await import('../app/app-api/v1/bookings/[id]/no-show/object/route')

const U = { cust: 'cx-cust', owner: 'cx-owner', bare: 'cx-bare', third: 'cx-third' }
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
let providerId: string, bareProviderId: string, serviceId: string
let g: FakeGateway
let slot = 0

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  await seedUser(U.cust)
  await seedUser(U.third)
  providerId = await seedProvider(U.owner, { name: 'Cx Owner', categoryId, price: 100 })
  bareProviderId = await seedProvider(U.bare, { name: 'Cx Bare', categoryId, price: 100 })
  await pool.query("UPDATE users SET language = 'en' WHERE id = ANY($1)", [[U.cust, U.owner]]) // the texts below are checked in English
  serviceId = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [providerId])).rows[0].id
  await pool.query("UPDATE providers SET stripe_account_id = 'acct_cx_1' WHERE id = $1", [providerId])
})
beforeEach(async () => {
  vi.stubEnv('PAYMENTS_ENABLED', 'true')
  g = fakeGateway()
  setGatewayForTests(g)
  clearOutbox()
  // every test sees only its own bookings in a sweep
  await pool.query("DELETE FROM notifications WHERE user_id LIKE 'cx-%'")
  await pool.query("DELETE FROM staff_flags WHERE user_id LIKE 'cx-%' OR ref_id = ANY($1)", [[providerId, bareProviderId]])
  await pool.query("UPDATE bookings SET status = 'expired' WHERE customer_id = 'cx-cust' AND status IN ('confirmed', 'finished', 'disputed', 'awaiting-payment')")
})
afterEach(() => {
  setGatewayForTests(undefined)
  vi.unstubAllEnvs()
})
afterAll(cleanupUsers)

/** A paid, confirmed booking (as the payment webhook leaves it), 60 minutes, 100 EUR, with its charge row. */
async function paidBooking(o: { startAt?: Date; provider?: string } = {}): Promise<{ id: string; startAt: Date }> {
  const p = o.provider ?? providerId
  const startAt = o.startAt ?? new Date(Date.now() + 3 * DAY + ++slot * 3 * HOUR)
  const service = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [p])).rows[0].id
  const id = (
    await pool.query(
      `INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, pay_by, paid_at, payment_ref, commission_rate)
       VALUES ($1, $2, $3, 'direct', 'confirmed', $4, 60, $4::timestamptz - interval '2 days', $4::timestamptz - interval '2 days', 'pi_cx_' || gen_random_uuid(), 0.12) RETURNING id`,
      [U.cust, p, service, startAt],
    )
  ).rows[0].id as string
  await pool.query("INSERT INTO ledger_entries (booking_id, provider_id, kind, amount, idempotency_key) VALUES ($1, $2, 'charge', 100, $3)", [id, p, `charge:${id}`])
  return { id, startAt }
}

/** An additional task of `parent` at `amount` (through a request and quote, as Task 6 makes them); paid = confirmed with its charge. */
async function child(parent: string, startAt: Date, amount: number, paid: boolean): Promise<string> {
  const req = (await pool.query("INSERT INTO requests (customer_id, provider_id, service_id, description, answer_by, parent_booking_id) VALUES ($1, $2, $3, 'Noch ein Tor', now() + interval '3 days', $4) RETURNING id", [U.cust, providerId, serviceId, parent])).rows[0].id
  const quote = (await pool.query("INSERT INTO quotes (request_id, provider_id, amount, scope, expires_at, status) VALUES ($1, $2, $3, 'Tor', now() + interval '7 days', 'accepted') RETURNING id", [req, providerId, amount])).rows[0].id
  const id = (
    await pool.query(
      `INSERT INTO bookings (customer_id, provider_id, quote_id, source, status, start_at, duration_min, parent_booking_id, pay_by, accepted_at, paid_at, payment_ref, commission_rate)
       VALUES ($1, $2, $3, 'quote', $4, $5, 60, $6, now() + interval '2 days', now(), $7, $8, 0.12) RETURNING id`,
      [U.cust, providerId, quote, paid ? 'confirmed' : 'awaiting-payment', startAt, parent, paid ? new Date() : null, paid ? `pi_cx_child_${randomUUID()}` : null],
    )
  ).rows[0].id as string
  if (paid) await pool.query("INSERT INTO ledger_entries (booking_id, provider_id, kind, amount, idempotency_key) VALUES ($1, $2, 'charge', $3, $4)", [id, providerId, amount, `charge:${id}`])
  return id
}

const row = async (id: string) =>
  (await pool.query('SELECT status, cancelled_at, cancelled_by, late_cancel, no_show, no_show_reported_at, released_at, asked_done_at FROM bookings WHERE id = $1', [id])).rows[0]
const ledger = async (id: string) => (await pool.query("SELECT kind, amount FROM ledger_entries WHERE booking_id = $1 AND kind <> 'charge' ORDER BY kind", [id])).rows
const notes = async (id: string) => (await pool.query("SELECT user_id, kind FROM notifications WHERE payload->>'bookingId' = $1 ORDER BY kind, user_id", [id])).rows
const callsOf = (method: string) => g.calls.filter((c) => c.method === method)
/** The money out (refund + transfer + commission) sums to the charge. */
const balanced = async (id: string) => {
  const s = (await pool.query("SELECT sum(amount) FILTER (WHERE kind = 'charge') c, sum(amount) FILTER (WHERE kind <> 'charge') o FROM ledger_entries WHERE booking_id = $1", [id])).rows[0]
  expect(s.o).toBe(s.c)
}
const reliability = async () => (await pool.query('SELECT provider_reliability($1) AS n', [providerId])).rows[0].n as number
const refusal = (p: Promise<unknown>) =>
  p.then(
    () => ({ status: 0, body: null }),
    async (e: unknown) => (e instanceof Response ? { status: e.status, body: await e.json() } : Promise.reject(e)),
  )
const cancel = (userId: string, id: string, now: Date) => asUser(userId, (tx) => cancelBooking(tx, userId, id, now))
const report = (userId: string, id: string, now: Date) => asUser(userId, (tx) => reportNoShow(tx, userId, id, now))
const object = (userId: string, id: string, now: Date, description = 'Ich war um 10 Uhr da und habe geklingelt.') => asUser(userId, (tx) => objectNoShow(tx, userId, id, { description }, now))

it('customer cancels 25 hours before: full refund, no commission', async () => {
  const now = new Date()
  const { id } = await paidBooking({ startAt: new Date(now.getTime() + 25 * HOUR) })
  const b = await cancel(U.cust, id, now)
  expect(b).toMatchObject({ status: 'cancelled', cancelledBy: 'customer', lateCancel: false, cancelledAt: now.toISOString(), noShow: null })
  expect(await ledger(id)).toEqual([{ kind: 'refund', amount: '100.00' }])
  expect(callsOf('refund').map((c) => (c.args as { amountCents: number }).amountCents)).toEqual([10_000])
  expect(callsOf('transfer')).toHaveLength(0)
  await balanced(id)
  expect((await row(id)).released_at).not.toBeNull()
  // the other side is told, without amounts
  expect(await notes(id)).toEqual([{ user_id: U.owner, kind: 'booking-cancelled' }])
  const mail = outboxForTests().find((m) => m.to === EMAIL(U.owner))!
  expect(mail.text).toMatch(/full amount back/)
  expect(mail.text).not.toMatch(/€|EUR|\d+[.,]\d{2}/)
  // a second tap: the same booking, nothing moves again, nobody is told twice
  expect((await cancel(U.cust, id, new Date(now.getTime() + MIN))).status).toBe('cancelled')
  expect(g.attempts.refund).toBe(1)
  expect(await notes(id)).toHaveLength(1)
})

it('customer cancels 23 hours before: provider share 50%, commission on that 50% only', async () => {
  const now = new Date()
  const { id } = await paidBooking({ startAt: new Date(now.getTime() + 23 * HOUR) })
  const open = appConnectionsAtMoneyCalls(g)
  const res = await call(cancelRoute.POST, U.cust, 'POST', undefined, { id })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ status: 'cancelled', cancelledBy: 'customer', lateCancel: true })
  expect(open).toEqual([0, 0]) // refund and transfer, with no request transaction open
  expect(await ledger(id)).toEqual([
    { kind: 'commission', amount: '6.00' },
    { kind: 'refund', amount: '50.00' },
    { kind: 'transfer', amount: '44.00' },
  ])
  await balanced(id)
  expect(outboxForTests().find((m) => m.to === EMAIL(U.owner))!.text).toMatch(/50%/)
})

it('provider cancels late: full refund and reliability count 1', async () => {
  const before = await reliability()
  const now = new Date()
  // early: free for the provider too, nothing recorded
  const early = await paidBooking({ startAt: new Date(now.getTime() + 25 * HOUR) })
  expect(await cancel(U.owner, early.id, now)).toMatchObject({ status: 'cancelled', cancelledBy: 'provider', lateCancel: false })
  expect(await ledger(early.id)).toEqual([{ kind: 'refund', amount: '100.00' }])
  expect(await reliability()).toBe(before)

  const { id } = await paidBooking({ startAt: new Date(now.getTime() + 2 * HOUR) })
  expect(await cancel(U.owner, id, now)).toMatchObject({ status: 'cancelled', cancelledBy: 'provider', lateCancel: true })
  expect(await ledger(id)).toEqual([{ kind: 'refund', amount: '100.00' }])
  await balanced(id)
  expect(await reliability()).toBe(before + 1)
  expect(await notes(id)).toEqual([{ user_id: U.cust, kind: 'booking-cancelled' }])
  expect(outboxForTests().find((m) => m.to === EMAIL(U.cust))!.text).toMatch(/provider cancelled/)
  // the public page shows the count
  expect((await asUser(null, (tx) => getPublicProfile(tx, `${U.owner}-slug`, 'en')))?.reliability).toBe(before + 1)

  // a late cancellation with a paid additional task counts once: roots only
  const root = await paidBooking({ startAt: new Date(now.getTime() + 3 * HOUR) })
  const extra = await child(root.id, root.startAt, 40, true)
  await cancel(U.owner, root.id, now)
  expect(await row(extra)).toMatchObject({ status: 'cancelled', cancelled_by: 'provider', late_cancel: true })
  expect(await ledger(extra)).toEqual([{ kind: 'refund', amount: '40.00' }])
  expect(await reliability()).toBe(before + 2)
})

it('cancelling after the start is 409 (use stop job or no-show)', async () => {
  const { id, startAt } = await paidBooking({ startAt: new Date(Date.now() - HOUR) })
  expect(await refusal(cancel(U.cust, id, new Date()))).toEqual({ status: 409, body: { error: 'STARTED' } })
  expect(await refusal(cancel(U.owner, id, startAt))).toEqual({ status: 409, body: { error: 'STARTED' } })
  expect((await row(id)).status).toBe('confirmed')
  expect(g.calls).toEqual([])
  // a third person: 404; an unpaid booking: 409 (withdraw it instead)
  expect((await call(cancelRoute.POST, U.third, 'POST', undefined, { id })).status).toBe(404)
  const unpaid = await child((await paidBooking()).id, new Date(Date.now() + 5 * DAY), 30, false)
  expect(await refusal(cancel(U.cust, unpaid, new Date()))).toEqual({ status: 409, body: { error: 'not-open' } })
  // a report that won the lock stands, even if the cancel's clock is a moment behind the start
  const reported = await paidBooking({ startAt: new Date(Date.now() - HOUR) })
  await report(U.cust, reported.id, new Date())
  expect(await refusal(cancel(U.owner, reported.id, new Date(reported.startAt.getTime() - 5)))).toEqual({ status: 409, body: { error: 'NO_SHOW_REPORTED' } })
  expect(await row(reported.id)).toMatchObject({ status: 'confirmed', no_show: 'provider', cancelled_at: null })
})

it('a suspended customer or provider can still cancel', async () => {
  const { id } = await paidBooking()
  await pool.query("UPDATE users SET suspended_until = now() + interval '1 day' WHERE id = $1", [U.cust])
  try {
    expect((await call(cancelRoute.POST, U.cust, 'POST', undefined, { id })).status).toBe(200)
  } finally {
    await pool.query('UPDATE users SET suspended_until = NULL WHERE id = $1', [U.cust])
  }
  expect((await row(id)).status).toBe('cancelled')
})

it('customer no-show unanswered for 48 hours pays the provider in full', async () => {
  const T = new Date('2028-05-02T08:00:00Z')
  const { id } = await paidBooking({ startAt: T })
  expect(await refusal(report(U.owner, id, new Date(T.getTime() - MIN)))).toEqual({ status: 409, body: { error: 'TOO_EARLY' } })
  const at = new Date(T.getTime() + 30 * MIN)
  const b = await report(U.owner, id, at)
  expect(b).toMatchObject({ status: 'confirmed', noShow: 'customer', noShowReportedAt: at.toISOString(), noShowObjectBy: new Date(at.getTime() + 48 * HOUR).toISOString() })
  expect(await report(U.owner, id, new Date(at.getTime() + MIN))).toMatchObject({ noShowReportedAt: at.toISOString() }) // a second tap changes nothing
  expect(await notes(id)).toEqual([{ user_id: U.cust, kind: 'no-show-reported' }])
  expect(outboxForTests().find((m) => m.to === EMAIL(U.cust))!.text).toMatch(/04[./]05[./]2028/) // the objection deadline
  // the other side cannot report back, finish or confirm while it is open
  expect(await refusal(report(U.cust, id, at))).toEqual({ status: 409, body: { error: 'NO_SHOW_REPORTED' } })
  expect(await refusal(asUser(U.owner, (tx) => finishJob(tx, U.owner, id, {}, at)))).toEqual({ status: 409, body: { error: 'NO_SHOW_REPORTED' } })

  expect((await runDueTimers(db, new Date(at.getTime() + 48 * HOUR - MIN))).noShowsResolved).toBe(0)
  expect(g.calls).toEqual([])
  const r = await runDueTimers(db, new Date(at.getTime() + 48 * HOUR))
  expect(r.noShowsResolved).toBe(1)
  expect(r.cancelsSettled).toBe(1)
  expect(await row(id)).toMatchObject({ status: 'cancelled', no_show: 'customer' })
  expect(await ledger(id)).toEqual([
    { kind: 'commission', amount: '12.00' },
    { kind: 'transfer', amount: '88.00' },
  ])
  await balanced(id)
  expect((await notes(id)).filter((n) => n.kind === 'booking-cancelled')).toEqual([{ user_id: U.owner, kind: 'booking-cancelled' }])
  expect(outboxForTests().find((m) => m.to === EMAIL(U.owner) && /did not turn up/.test(m.text))!.text).not.toMatch(/released/) // the text never says the money moved
  expect((await runDueTimers(db, new Date(at.getTime() + 50 * HOUR))).noShowsResolved).toBe(0)
  expect(g.attempts.transfer).toBe(1)
})

it('provider no-show unanswered for 48 hours refunds fully', async () => {
  const before = await reliability()
  const { id } = await paidBooking({ startAt: new Date(Date.now() - 2 * HOUR) }) // the route reports at the real time
  const res = await call(noShowRoute.POST, U.cust, 'POST', undefined, { id })
  expect(res.status).toBe(200)
  const at = new Date((await res.json()).noShowReportedAt)
  expect(await notes(id)).toEqual([{ user_id: U.owner, kind: 'no-show-reported' }])
  expect((await runDueTimers(db, new Date(at.getTime() + 48 * HOUR))).noShowsResolved).toBe(1)
  expect(await row(id)).toMatchObject({ status: 'cancelled', no_show: 'provider' })
  expect(await ledger(id)).toEqual([{ kind: 'refund', amount: '100.00' }])
  await balanced(id)
  expect(await reliability()).toBe(before + 1)
  expect((await notes(id)).filter((n) => n.kind === 'booking-cancelled')).toEqual([{ user_id: U.cust, kind: 'booking-cancelled' }])
})

it('a reported no-show is left out of the silent-provider rules', async () => {
  const T = new Date('2028-05-16T08:00:00Z')
  const end = T.getTime() + HOUR
  // reported before the customer would be asked: never asked
  const fresh = await paidBooking({ startAt: T })
  await report(U.owner, fresh.id, new Date(T.getTime() + 2 * HOUR))
  expect((await runDueTimers(db, new Date(end + 25 * HOUR))).askedDone).toBe(0)
  expect((await row(fresh.id)).asked_done_at).toBeNull()
  // asked already, then reported late (the objection window still open at day 8): never sent to staff, no confirm
  const asked = await paidBooking({ startAt: new Date(T.getTime() + 3 * HOUR) })
  await pool.query('UPDATE bookings SET asked_done_at = $2 WHERE id = $1', [asked.id, new Date(end + 3 * HOUR + DAY)])
  await report(U.cust, asked.id, new Date(end + 3 * HOUR + 7 * DAY))
  await pool.query("UPDATE bookings SET status = 'expired' WHERE id = $1", [fresh.id]) // out of the way
  expect(await runDueTimers(db, new Date(end + 3 * HOUR + 8 * DAY))).toMatchObject({ sentToStaff: 0, noShowsResolved: 0 })
  expect((await row(asked.id)).status).toBe('confirmed')
  expect(await refusal(asUser(U.cust, (tx) => confirmJob(tx, U.cust, asked.id, new Date(end + 3 * HOUR + 8 * DAY))))).toEqual({ status: 409, body: { error: 'NO_SHOW_REPORTED' } })
})

it('an objection within 48 hours opens a dispute and moves no money', async () => {
  const T = new Date('2028-05-23T08:00:00Z')
  const { id } = await paidBooking({ startAt: T })
  const at = new Date(T.getTime() + HOUR)
  await report(U.cust, id, at)
  // only the reported side objects; a third person sees nothing
  expect(await refusal(object(U.cust, id, at))).toEqual({ status: 403, body: { error: 'not-your-turn' } })
  expect((await call(objectRoute.POST, U.third, 'POST', { description: 'x' }, { id })).status).toBe(404)
  expect((await call(objectRoute.POST, U.owner, 'POST', { description: 'Ruf mich an: 0170 1234567' }, { id })).status).toBe(422)
  expect((await call(objectRoute.POST, U.owner, 'POST', { description: '' }, { id })).status).toBe(400)
  const now = new Date(at.getTime() + 47 * HOUR)
  const b = await object(U.owner, id, now)
  expect(b.status).toBe('disputed')
  const d = (await pool.query('SELECT opened_by, reason, description, decide_by, decided_at FROM disputes WHERE booking_id = $1', [id])).rows
  expect(d).toEqual([{ opened_by: 'provider', reason: 'no-show-objection', description: 'Ich war um 10 Uhr da und habe geklingelt.', decide_by: new Date('2028-06-14T08:00:00Z'), decided_at: null }])
  expect((await object(U.owner, id, now)).status).toBe('disputed') // a second tap: the same dispute
  expect((await pool.query('SELECT count(*)::int n FROM disputes WHERE booking_id = $1', [id])).rows[0].n).toBe(1)
  expect(await runDueTimers(db, new Date(at.getTime() + 60 * HOUR))).toMatchObject({ noShowsResolved: 0, cancelsSettled: 0 })
  expect((await row(id)).status).toBe('disputed')
  expect(g.calls).toEqual([])

  // after the 48 hours: too late
  const late = await paidBooking({ startAt: new Date(T.getTime() + 3 * HOUR) })
  const lateAt = new Date(late.startAt.getTime() + HOUR)
  await report(U.cust, late.id, lateAt)
  expect(await refusal(object(U.owner, late.id, new Date(lateAt.getTime() + 48 * HOUR)))).toEqual({ status: 409, body: { error: 'OBJECTION_CLOSED' } })
})

it('a second provider no-show in 12 months flags staff', async () => {
  const flags = async () => (await pool.query("SELECT ref_id FROM staff_flags WHERE kind = 'provider-no-shows' AND resolved_at IS NULL")).rows
  const warnings = async () => (await pool.query("SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND kind = 'provider-warning'", [U.owner])).rows[0].n
  // the earlier no-shows of this file were reported in 2028; these come over a year later
  const T = new Date('2029-09-03T08:00:00Z')
  const first = await paidBooking({ startAt: T })
  await report(U.cust, first.id, new Date(T.getTime() + HOUR))
  await runDueTimers(db, new Date(T.getTime() + 50 * HOUR))
  expect(await warnings()).toBe(1)
  expect(await flags()).toEqual([])
  expect(outboxForTests().some((m) => m.to === EMAIL(U.owner) && /12 months/.test(m.text))).toBe(true)

  const second = await paidBooking({ startAt: new Date(T.getTime() + 30 * DAY) })
  await report(U.cust, second.id, new Date(T.getTime() + 30 * DAY + HOUR))
  await runDueTimers(db, new Date(T.getTime() + 30 * DAY + 50 * HOUR))
  expect(await flags()).toEqual([{ ref_id: providerId }])
  expect(await warnings()).toBe(1)

  // a third: still one open flag
  const third = await paidBooking({ startAt: new Date(T.getTime() + 60 * DAY) })
  await report(U.cust, third.id, new Date(T.getTime() + 60 * DAY + HOUR))
  await runDueTimers(db, new Date(T.getTime() + 60 * DAY + 50 * HOUR))
  expect(await flags()).toEqual([{ ref_id: providerId }])
})

it('cancelling a booking with an unpaid and a paid additional task handles both', async () => {
  const now = new Date()
  const { id, startAt } = await paidBooking({ startAt: new Date(now.getTime() + 23 * HOUR) })
  const unpaid = await child(id, startAt, 30, false)
  const paid = await child(id, startAt, 40, true)
  await cancel(U.cust, id, now)
  expect((await row(unpaid)).status).toBe('withdrawn')
  expect(await ledger(unpaid)).toEqual([])
  expect(await row(paid)).toMatchObject({ status: 'cancelled', cancelled_by: 'customer', late_cancel: true })
  expect(await ledger(paid)).toEqual([
    { kind: 'commission', amount: '2.40' },
    { kind: 'refund', amount: '20.00' },
    { kind: 'transfer', amount: '17.60' },
  ])
  await balanced(paid)
  expect(await ledger(id)).toEqual([
    { kind: 'commission', amount: '6.00' },
    { kind: 'refund', amount: '50.00' },
    { kind: 'transfer', amount: '44.00' },
  ])
  // nothing left over for the timer
  expect((await runDueTimers(db, new Date(now.getTime() + HOUR))).cancelsSettled).toBe(0)
})

it('settle failure keeps the cancel recorded and the timer retries', async () => {
  const now = new Date()
  // no payout account: the cancellation stands, staff are told, the money follows once the account exists
  const bare = await paidBooking({ provider: bareProviderId, startAt: new Date(now.getTime() + 20 * HOUR) })
  expect(await cancel(U.cust, bare.id, now)).toMatchObject({ status: 'cancelled', cancelledBy: 'customer', lateCancel: true })
  expect(await row(bare.id)).toMatchObject({ status: 'cancelled', released_at: null })
  expect((await pool.query("SELECT note FROM staff_flags WHERE kind = 'payment-unprocessed' AND ref_id = $1", [bare.id])).rows).toEqual([{ note: 'release failed: NO_PAYOUT_ACCOUNT' }])
  expect((await runDueTimers(db, new Date(now.getTime() + MIN))).cancelsSettled).toBe(0)
  await pool.query("UPDATE providers SET stripe_account_id = 'acct_cx_bare' WHERE id = $1", [bareProviderId])
  try {
    expect((await runDueTimers(db, new Date(now.getTime() + HOUR))).cancelsSettled).toBe(1)
  } finally {
    await pool.query('UPDATE providers SET stripe_account_id = NULL WHERE id = $1', [bareProviderId])
  }
  expect(await ledger(bare.id)).toEqual([
    { kind: 'commission', amount: '6.00' },
    { kind: 'refund', amount: '50.00' },
    { kind: 'transfer', amount: '44.00' },
  ])
  expect((await pool.query('SELECT resolved_by FROM staff_flags WHERE ref_id = $1', [bare.id])).rows).toEqual([{ resolved_by: 'system' }])

  // the transfer fails after the refund went out: the retry pays the same split (never a second refund, never a mismatch)
  const { id } = await paidBooking({ startAt: new Date(now.getTime() + 20 * HOUR) })
  const transfer = g.transfer
  g.transfer = async () => {
    throw new Error('gateway down')
  }
  await cancel(U.cust, id, now)
  expect(await ledger(id)).toEqual([{ kind: 'refund', amount: '50.00' }])
  g.transfer = transfer
  expect((await runDueTimers(db, new Date(now.getTime() + HOUR))).cancelsSettled).toBe(1)
  expect(await ledger(id)).toEqual([
    { kind: 'commission', amount: '6.00' },
    { kind: 'refund', amount: '50.00' },
    { kind: 'transfer', amount: '44.00' },
  ])
  expect(g.attempts.refund).toBe(2) // the bare booking's and this one's: each once
  await balanced(id)
})

it('cancel racing a second cancel and the timer: exactly one outcome', async () => {
  const now = new Date()
  const { id } = await paidBooking({ startAt: new Date(now.getTime() + 2 * DAY) })
  const holder = await pool.connect()
  let all: Promise<unknown[]>
  try {
    await holder.query('BEGIN')
    await holder.query('SELECT 1 FROM bookings WHERE id = $1 FOR UPDATE', [id])
    all = Promise.all([cancel(U.cust, id, now), cancel(U.owner, id, now), runDueTimers(db, now)])
    await new Promise((ok) => setTimeout(ok, 500))
    expect((await row(id)).status).toBe('confirmed')
    await holder.query('COMMIT')
  } finally {
    holder.release()
  }
  const [a, b] = (await all!) as { status: string; cancelledBy: string }[]
  expect(a!.status).toBe('cancelled')
  expect(b!.status).toBe('cancelled')
  expect(a!.cancelledBy).toBe(b!.cancelledBy) // one cancellation; the second tap returned it
  expect(await ledger(id)).toEqual([{ kind: 'refund', amount: '100.00' }])
  expect(g.attempts.refund).toBe(1)
  expect(await notes(id)).toHaveLength(1)
})

it('a cancelled booking frees its slot and is excluded from timers', async () => {
  const now = new Date()
  const { id, startAt } = await paidBooking({ startAt: new Date(now.getTime() + 2 * DAY) })
  const busy = async () => (await asUser(null, (tx) => tx.execute(sql`SELECT state FROM busy_times(${providerId}::uuid, ${new Date(startAt.getTime() - HOUR).toISOString()}::timestamptz, ${new Date(startAt.getTime() + 2 * HOUR).toISOString()}::timestamptz)`))).rows
  expect(await slotIsHeld(db, providerId, startAt, 60, false, now)).toBe(true)
  expect(await busy()).toEqual([{ state: 'booked' }])
  await cancel(U.cust, id, now)
  expect(await slotIsHeld(db, providerId, startAt, 60, false, now)).toBe(false)
  expect(await busy()).toEqual([])
  const r = await runDueTimers(db, new Date(startAt.getTime() + 10 * DAY))
  expect(r).toMatchObject({ askedDone: 0, sentToStaff: 0, noShowsResolved: 0, cancelsSettled: 0 })
  expect(await row(id)).toMatchObject({ status: 'cancelled', asked_done_at: null })
})
