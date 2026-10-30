import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { asUser, db, pool } from '@kando/db'
import {
  answerStop,
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
  stateStopAmount,
  staffMayReadThread,
  stopJob,
} from '@kando/domain'
import { call, cleanupUsers, EMAIL, seedBase, seedProvider, seedUser } from './helpers'
import { fakeGateway, type FakeGateway } from './fake-gateway'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const disputeRoute = await import('../app/app-api/v1/bookings/[id]/dispute/route')
const stopRoute = await import('../app/app-api/v1/bookings/[id]/stop/route')
const amountRoute = await import('../app/app-api/v1/bookings/[id]/stop/amount/route')
const answerRoute = await import('../app/app-api/v1/bookings/[id]/stop/answer/route')

const U = { cust: 'dp-cust', owner: 'dp-owner', bare: 'dp-bare', third: 'dp-third', quiet: 'dp-quiet', busy: 'dp-busy' }
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
let providerId: string, bareProviderId: string, quietProviderId: string, busyProviderId: string
let g: FakeGateway
let slot = 0

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  await seedUser(U.cust)
  await seedUser(U.third)
  providerId = await seedProvider(U.owner, { name: 'Dp Owner', categoryId, price: 100 })
  bareProviderId = await seedProvider(U.bare, { name: 'Dp Bare', categoryId, price: 100 })
  quietProviderId = await seedProvider(U.quiet, { name: 'Dp Quiet', categoryId, price: 100 })
  busyProviderId = await seedProvider(U.busy, { name: 'Dp Busy', categoryId, price: 100 })
  await pool.query("UPDATE users SET language = 'en' WHERE id = ANY($1)", [[U.cust, U.owner]])
  await pool.query("UPDATE providers SET stripe_account_id = 'acct_dp_1' WHERE id = $1", [providerId])
})
beforeEach(async () => {
  vi.stubEnv('PAYMENTS_ENABLED', 'true')
  g = fakeGateway()
  setGatewayForTests(g)
  clearOutbox()
  // every test sees only its own bookings in a sweep
  await pool.query("DELETE FROM notifications WHERE user_id LIKE 'dp-%'")
  await pool.query("DELETE FROM staff_flags WHERE user_id LIKE 'dp-%'")
  await pool.query("UPDATE bookings SET status = 'expired' WHERE customer_id = 'dp-cust' AND status IN ('confirmed', 'finished', 'disputed', 'stopped')")
  await pool.query("UPDATE disputes SET decision = 'full-refund', provider_share = 0, decision_reason = 'test', decided_at = now() WHERE decided_at IS NULL AND booking_id IN (SELECT id FROM bookings WHERE customer_id = 'dp-cust')")
})
afterEach(() => {
  setGatewayForTests(undefined)
  vi.unstubAllEnvs()
})
afterAll(cleanupUsers)

/** A paid booking (as the payment webhook leaves it), 60 minutes, 100 EUR, with its charge row; `finishedAt` makes it finished. */
async function paidBooking(o: { startAt?: Date; provider?: string; finishedAt?: Date; paymentRef?: string; parent?: string } = {}): Promise<{ id: string; startAt: Date }> {
  const ref = o.paymentRef ?? `pi_dp_${randomUUID()}`
  const p = o.provider ?? providerId
  const startAt = o.startAt ?? new Date(Date.now() - 2 * HOUR - ++slot * 3 * HOUR)
  const service = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [p])).rows[0].id
  const id = (
    await pool.query(
      `INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, pay_by, paid_at, payment_ref, commission_rate, finished_at, confirm_by, parent_booking_id)
       VALUES ($1, $2, $3, 'direct', $4, $5, 60, $5::timestamptz - interval '2 days', $5::timestamptz - interval '2 days', $7, 0.12, $6::timestamptz, $6::timestamptz + interval '7 days', $8) RETURNING id`,
      [U.cust, p, service, o.finishedAt ? 'finished' : 'confirmed', startAt, o.finishedAt ?? null, ref, o.parent ?? null],
    )
  ).rows[0].id as string
  await pool.query("INSERT INTO ledger_entries (booking_id, provider_id, kind, amount, gateway_ref, idempotency_key) VALUES ($1, $2, 'charge', 100, $3, $4)", [id, p, ref, `charge:${id}`])
  return { id, startAt }
}

const row = async (id: string) => (await pool.query('SELECT status, stopped_by, stop_amount, stop_note, stop_stated_at, confirm_by, released_at FROM bookings WHERE id = $1', [id])).rows[0]
const ledger = async (id: string) => (await pool.query("SELECT kind, amount FROM ledger_entries WHERE booking_id = $1 AND kind <> 'charge' ORDER BY kind", [id])).rows
const disputesOf = async (id: string) => (await pool.query('SELECT opened_by, reason, description, decide_by FROM disputes WHERE booking_id = $1', [id])).rows
const notes = async (id: string, kind: string) => (await pool.query('SELECT user_id FROM notifications WHERE kind = $1 AND payload->>$3 = $2 ORDER BY user_id', [kind, id, 'bookingId'])).rows.map((r) => r.user_id)
const refusal = (p: Promise<unknown>) =>
  p.then(
    () => ({ status: 0, body: null }),
    async (e: unknown) => (e instanceof Response ? { status: e.status, body: await e.json() } : Promise.reject(e)),
  )
const dispute = (userId: string, id: string, now: Date, description = 'Die Fliesen sind schief verlegt.') => asUser(userId, (tx) => openDispute(tx, userId, id, { description }, now))
const stop = (userId: string, id: string, now: Date) => asUser(userId, (tx) => stopJob(tx, userId, id, now))
const state = (userId: string, id: string, amount: number, now: Date, note?: string) => asUser(userId, (tx) => stateStopAmount(tx, userId, id, { amount, ...(note && { note }) }, now))
const answer = (userId: string, id: string, agree: boolean, now: Date) => asUser(userId, (tx) => answerStop(tx, userId, id, { agree }, now))

it('the customer disputes within 7 days of Finished; the timer then releases nothing', async () => {
  const T = new Date('2027-06-07T08:00:00Z') // a Monday
  const { id } = await paidBooking({ startAt: new Date(T.getTime() - 2 * HOUR), finishedAt: T })
  // a third person sees nothing; contact details and an empty text are refused
  expect((await call(disputeRoute.POST, U.third, 'POST', { description: 'x' }, { id })).status).toBe(404)
  expect((await call(disputeRoute.POST, U.cust, 'POST', { description: 'Schreib mir: kunde@example.com' }, { id })).status).toBe(422)
  expect((await call(disputeRoute.POST, U.cust, 'POST', { description: '' }, { id })).status).toBe(400)
  expect((await row(id)).status).toBe('finished')

  const d = await dispute(U.cust, id, new Date(T.getTime() + 3 * DAY))
  expect(d).toMatchObject({ bookingId: id, openedBy: 'customer', reason: 'problem', description: 'Die Fliesen sind schief verlegt.', decision: null, decideBy: '2027-06-30T08:00:00.000Z' }) // Thursday + 14 working days
  expect(d).not.toHaveProperty('decidedBy')
  expect((await row(id)).status).toBe('disputed')
  // a second tap returns the same dispute
  expect((await dispute(U.cust, id, new Date(T.getTime() + 3 * DAY + HOUR))).id).toBe(d.id)
  expect(await disputesOf(id)).toHaveLength(1)
  // both are told; the provider reads the description
  expect(await notes(id, 'dispute-opened')).toEqual([U.cust, U.owner].sort())
  expect(outboxForTests().filter((m) => m.to === EMAIL(U.cust) || m.to === EMAIL(U.owner))).toHaveLength(2)
  for (const m of outboxForTests()) expect(m.text).not.toMatch(/Treuhand|Escrow|Garantie|guarantee/i)
  const seen = await call(disputeRoute.GET, U.owner, 'GET', undefined, { id })
  expect(seen.status).toBe(200)
  expect(await seen.json()).toMatchObject({ id: d.id, description: 'Die Fliesen sind schief verlegt.' })
  expect((await call(disputeRoute.GET, U.third, 'GET', undefined, { id })).status).toBe(404)

  // frozen: the timer releases nothing, sends no reminder, and Finished/confirm/cancel/stop are refused
  const r = await runDueTimers(db, new Date(T.getTime() + 8 * DAY))
  expect(r).toMatchObject({ autoReleased: 0 })
  expect(await ledger(id)).toEqual([])
  expect(g.calls).toEqual([])
  const later = new Date(T.getTime() + 8 * DAY)
  const notOpen = { status: 409, body: { error: 'not-open' } }
  expect(await refusal(stop(U.owner, id, later))).toEqual(notOpen)
  expect(await refusal(asUser(U.owner, (tx) => finishJob(tx, U.owner, id, {}, later)))).toEqual(notOpen)
  expect(await refusal(asUser(U.cust, (tx) => confirmJob(tx, U.cust, id, later)))).toEqual(notOpen)
  expect(await refusal(asUser(U.cust, (tx) => cancelBooking(tx, U.cust, id, later)))).toEqual(notOpen)
  expect((await row(id)).status).toBe('disputed')
  expect(await ledger(id)).toEqual([])
})

it('a dispute after the 7 days is 409', async () => {
  const T = new Date('2027-06-14T08:00:00Z')
  const { id } = await paidBooking({ startAt: new Date(T.getTime() - 2 * HOUR), finishedAt: T })
  expect(await refusal(dispute(U.cust, id, new Date(T.getTime() + 7 * DAY)))).toEqual({ status: 409, body: { error: 'DISPUTE_CLOSED' } })
  expect((await dispute(U.cust, id, new Date(T.getTime() + 7 * DAY - MIN))).reason).toBe('problem') // a minute before: still open
  // a confirmed booking can be disputed only once the customer was asked "Was the job done?"
  const c = await paidBooking({ startAt: new Date(T.getTime() - 3 * DAY) })
  expect(await refusal(dispute(U.cust, c.id, T))).toEqual({ status: 409, body: { error: 'not-open' } })
  await pool.query('UPDATE bookings SET asked_done_at = $2 WHERE id = $1', [c.id, T])
  expect((await dispute(U.cust, c.id, T)).reason).toBe('problem')
  expect((await row(c.id)).status).toBe('disputed')
})

it('dispute and auto-release race: exactly one outcome', async () => {
  for (const round of [0, 1, 2, 3]) {
    const opener = round < 2 ? U.cust : U.owner // either side may be the one racing the release
    const T = new Date(Date.now() - 8 * DAY - round * HOUR)
    const { id } = await paidBooking({ startAt: new Date(T.getTime() - 2 * HOUR), finishedAt: T })
    await pool.query('UPDATE bookings SET confirm_reminders_sent = 3 WHERE id = $1', [id])
    const confirmBy = new Date(T.getTime() + 7 * DAY)
    const holder = await pool.connect()
    let both: Promise<[Awaited<ReturnType<typeof refusal>>, Awaited<ReturnType<typeof runDueTimers>>]>
    try {
      await holder.query('BEGIN')
      await holder.query('SELECT 1 FROM bookings WHERE id = $1 FOR UPDATE', [id])
      // the dispute comes a minute before the 7 days end; the timer runs once they have
      const d = refusal(dispute(opener, id, new Date(confirmBy.getTime() - MIN)))
      both = Promise.all([round % 2 ? new Promise<void>((ok) => setTimeout(ok, 100)).then(() => d) : d, runDueTimers(db, new Date(confirmBy.getTime() + MIN))])
      await new Promise((ok) => setTimeout(ok, 400))
      await holder.query('COMMIT')
    } finally {
      holder.release()
    }
    const [opened, report] = await both!
    const status = (await row(id)).status
    if (status === 'disputed') {
      expect(opened.status).toBe(0)
      expect(await ledger(id)).toEqual([])
      expect(await disputesOf(id)).toMatchObject([{ opened_by: opener === U.cust ? 'customer' : 'provider', reason: 'problem' }])
      expect(report.autoReleased).toBe(0)
    } else {
      expect(status).toBe('completed')
      expect(opened).toEqual({ status: 409, body: { error: 'not-open' } })
      expect(await disputesOf(id)).toHaveLength(0)
      expect(await ledger(id)).toEqual([
        { kind: 'commission', amount: '12.00' },
        { kind: 'transfer', amount: '88.00' },
      ])
    }
  }
})

it('the provider disputes a finished booking: disputed, the release stops, both told', async () => {
  const T = new Date('2027-11-01T08:00:00Z')
  const { id } = await paidBooking({ startAt: new Date(T.getTime() - 2 * HOUR), finishedAt: T })
  const res = await call(disputeRoute.POST, U.owner, 'POST', { description: 'Der Kunde hat das Material selbst entfernt.' }, { id })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ bookingId: id, openedBy: 'provider', reason: 'problem', decision: null })
  expect((await row(id)).status).toBe('disputed')
  expect(await notes(id, 'dispute-opened')).toEqual([U.cust, U.owner].sort())
  expect((await runDueTimers(db, new Date(T.getTime() + 8 * DAY))).autoReleased).toBe(0)
  expect(await ledger(id)).toEqual([])
  expect(g.calls).toEqual([])
  // the provider's own dispute again on a second tap; after the 7 days the provider is refused like the customer
  expect((await dispute(U.owner, id, new Date(T.getTime() + HOUR))).openedBy).toBe('provider')
  const late = await paidBooking({ startAt: new Date(T.getTime() - 5 * HOUR), finishedAt: new Date(T.getTime() - 3 * HOUR) })
  expect(await refusal(dispute(U.owner, late.id, new Date(T.getTime() + 7 * DAY)))).toEqual({ status: 409, body: { error: 'DISPUTE_CLOSED' } })
  // a confirmed job (even once the customer was asked) is not the provider's to dispute
  const c = await paidBooking({ startAt: new Date(T.getTime() - 3 * DAY) })
  await pool.query('UPDATE bookings SET asked_done_at = $2 WHERE id = $1', [c.id, T])
  expect(await refusal(dispute(U.owner, c.id, T))).toEqual({ status: 409, body: { error: 'not-open' } })
})

it('either side disputes a stopped booking before an amount is agreed; after agreement 409 not-open', async () => {
  const S = new Date('2027-11-08T08:00:00Z')
  // the customer stopped, nothing stated: the provider disputes
  const a = await paidBooking({ startAt: S })
  await stop(U.cust, a.id, new Date(S.getTime() + HOUR))
  expect((await dispute(U.owner, a.id, new Date(S.getTime() + 2 * HOUR))).openedBy).toBe('provider')
  expect((await row(a.id)).status).toBe('disputed')
  expect(await notes(a.id, 'dispute-opened')).toEqual([U.cust, U.owner].sort())
  // the provider stopped and stated 40: the customer disputes instead of answering
  const b = await paidBooking({ startAt: new Date(S.getTime() + 3 * HOUR) })
  await stop(U.owner, b.id, new Date(S.getTime() + 4 * HOUR))
  await state(U.owner, b.id, 40, new Date(S.getTime() + 4 * HOUR))
  expect(await dispute(U.cust, b.id, new Date(S.getTime() + 5 * HOUR))).toMatchObject({ openedBy: 'customer', reason: 'problem' })
  expect((await row(b.id)).status).toBe('disputed')
  expect(await ledger(b.id)).toEqual([])
  // agreed (the payout failed, so it is still stopped with the payment due): neither side may dispute
  const c = await paidBooking({ provider: bareProviderId, startAt: new Date(S.getTime() + 6 * HOUR) })
  await stop(U.bare, c.id, new Date(S.getTime() + 7 * HOUR))
  await state(U.bare, c.id, 40, new Date(S.getTime() + 7 * HOUR))
  await answer(U.cust, c.id, true, new Date(S.getTime() + 8 * HOUR))
  expect((await row(c.id)).status).toBe('stopped')
  const notOpen = { status: 409, body: { error: 'not-open' } }
  expect(await refusal(dispute(U.cust, c.id, new Date(S.getTime() + 9 * HOUR)))).toEqual(notOpen)
  expect(await refusal(dispute(U.bare, c.id, new Date(S.getTime() + 9 * HOUR)))).toEqual(notOpen)
  expect(await disputesOf(c.id)).toEqual([])
})

it('the second opener gets 409 DISPUTE_EXISTS, the first its own dispute again', async () => {
  const T = new Date('2027-11-15T08:00:00Z')
  const { id } = await paidBooking({ startAt: new Date(T.getTime() - 2 * HOUR), finishedAt: T })
  const first = await dispute(U.cust, id, new Date(T.getTime() + HOUR))
  expect(await refusal(dispute(U.owner, id, new Date(T.getTime() + 2 * HOUR)))).toEqual({ status: 409, body: { error: 'DISPUTE_EXISTS' } })
  expect((await dispute(U.cust, id, new Date(T.getTime() + 3 * HOUR))).id).toBe(first.id)
  expect(await disputesOf(id)).toHaveLength(1)
  // a dispute of another kind (the customer's stop disagreement) is not a problem report: 409 DISPUTE_EXISTS for both
  const s = await paidBooking({ startAt: new Date(T.getTime() + 4 * HOUR) })
  await stop(U.owner, s.id, new Date(T.getTime() + 5 * HOUR))
  await state(U.owner, s.id, 40, new Date(T.getTime() + 5 * HOUR))
  await answer(U.cust, s.id, false, new Date(T.getTime() + 6 * HOUR))
  for (const u of [U.cust, U.owner]) expect(await refusal(dispute(u, s.id, new Date(T.getTime() + 7 * HOUR)))).toEqual({ status: 409, body: { error: 'DISPUTE_EXISTS' } })
})

it('either side can stop; the provider states 40 of 100; the customer agrees: refund 60, provider share 40, commission on 40', async () => {
  const T = new Date('2027-09-06T08:00:00Z')
  // the provider may stop too
  const p = await paidBooking({ startAt: T })
  expect((await stop(U.owner, p.id, new Date(T.getTime() + HOUR))).stoppedBy).toBe('provider')
  expect(await notes(p.id, 'job-stopped')).toEqual([U.cust])

  const { id } = await paidBooking() // started a few hours ago: the route uses the real clock
  expect((await call(stopRoute.POST, U.third, 'POST', undefined, { id })).status).toBe(404)
  const stopped = await call(stopRoute.POST, U.cust, 'POST', undefined, { id })
  expect(stopped.status).toBe(200)
  expect(await stopped.json()).toMatchObject({ status: 'stopped', stoppedBy: 'customer', stopAmount: null })
  expect((await call(stopRoute.POST, U.cust, 'POST', undefined, { id })).status).toBe(200) // a second tap: unchanged
  expect(await notes(id, 'job-stopped')).toEqual([U.owner])
  expect((await row(id)).stopped_by).toBe('customer')

  // only the provider states the amount; only the customer answers
  expect((await call(amountRoute.POST, U.cust, 'POST', { amount: 40 }, { id })).status).toBe(403)
  expect((await call(amountRoute.POST, U.third, 'POST', { amount: 40 }, { id })).status).toBe(404)
  expect((await call(answerRoute.POST, U.cust, 'POST', { agree: true }, { id })).status).toBe(409) // nothing stated yet
  const stated = await call(amountRoute.POST, U.owner, 'POST', { amount: 40, note: 'Zwei von fünf Stunden gearbeitet.' }, { id })
  expect(stated.status).toBe(200)
  expect(await stated.json()).toMatchObject({ status: 'stopped', stopAmount: 40, stopNote: 'Zwei von fünf Stunden gearbeitet.' })
  expect((await call(amountRoute.POST, U.owner, 'POST', { amount: 40, note: 'Zwei von fünf Stunden gearbeitet.' }, { id })).status).toBe(200) // the same again: unchanged
  expect((await call(amountRoute.POST, U.owner, 'POST', { amount: 50 }, { id })).status).toBe(409) // final once stated
  expect(await notes(id, 'stop-amount-stated')).toEqual([U.cust])
  expect(outboxForTests().find((m) => m.to === EMAIL(U.cust) && /amount/i.test(m.subject))!.text).toMatch(/\d{2}[./]\d{2}[./]\d{4}/) // until when to answer
  expect((await call(answerRoute.POST, U.owner, 'POST', { agree: true }, { id })).status).toBe(403)
  expect((await call(answerRoute.POST, U.third, 'POST', { agree: true }, { id })).status).toBe(404)

  const agreed = await call(answerRoute.POST, U.cust, 'POST', { agree: true }, { id })
  expect(agreed.status).toBe(200)
  expect((await agreed.json()).status).toBe('completed')
  expect(await ledger(id)).toEqual([
    { kind: 'commission', amount: '4.80' },
    { kind: 'refund', amount: '60.00' },
    { kind: 'transfer', amount: '35.20' },
  ])
  expect((await row(id)).status).toBe('completed')
  expect(await notes(id, 'payment-released')).toEqual([U.cust, U.owner].sort())
  const toCustomer = outboxForTests().filter((m) => m.to === EMAIL(U.cust)).at(-2)!
  expect(toCustomer.text).toMatch(/refund/i)
  // a second answer changes nothing
  expect((await call(answerRoute.POST, U.cust, 'POST', { agree: true }, { id })).status).toBe(200)
  expect(g.attempts.transfer).toBe(1)
})

it('a stated amount above the price is 400', async () => {
  const { id, startAt } = await paidBooking({ startAt: new Date('2027-09-13T08:00:00Z') })
  expect(await refusal(state(U.owner, id, 40, startAt))).toEqual({ status: 409, body: { error: 'not-open' } }) // not stopped yet
  await stop(U.cust, id, new Date(startAt.getTime() + HOUR))
  expect(await refusal(state(U.owner, id, 100.01, startAt))).toEqual({ status: 400, body: { error: 'INVALID_STOP_AMOUNT' } })
  expect((await call(amountRoute.POST, U.owner, 'POST', { amount: -1 }, { id })).status).toBe(400)
  expect((await call(amountRoute.POST, U.owner, 'POST', { amount: 10.001 }, { id })).status).toBe(400)
  expect(await refusal(state(U.owner, id, 10.001, startAt))).toEqual({ status: 400, body: { error: 'INVALID_STOP_AMOUNT' } }) // the domain too, never rounded
  expect((await call(amountRoute.POST, U.owner, 'POST', { amount: 10, note: 'Ruf an: 0170 1234567' }, { id })).status).toBe(422)
  expect((await row(id)).stop_amount).toBeNull()
  expect((await state(U.owner, id, 100, startAt)).stopAmount).toBe(100) // the whole price is allowed
})

it('stopping before the start is 409 NOT_STARTED (the cancellation rules apply)', async () => {
  const { id, startAt } = await paidBooking({ startAt: new Date('2027-09-14T08:00:00Z') })
  expect(await refusal(stop(U.owner, id, new Date(startAt.getTime() - MIN)))).toEqual({ status: 409, body: { error: 'NOT_STARTED' } })
  expect(await refusal(stop(U.cust, id, new Date(startAt.getTime() - 3 * HOUR)))).toEqual({ status: 409, body: { error: 'NOT_STARTED' } })
  expect((await row(id)).status).toBe('confirmed')
  expect((await stop(U.owner, id, startAt)).status).toBe('stopped') // from the start on
})

it('the customer disagrees: a stop-disagreed dispute', async () => {
  const { id, startAt } = await paidBooking({ startAt: new Date('2027-09-20T08:00:00Z') })
  await stop(U.owner, id, new Date(startAt.getTime() + HOUR))
  await state(U.owner, id, 70, new Date(startAt.getTime() + 2 * HOUR))
  const b = await answer(U.cust, id, false, new Date(startAt.getTime() + 3 * HOUR))
  expect(b.status).toBe('disputed')
  expect(await disputesOf(id)).toEqual([{ opened_by: 'customer', reason: 'stop-disagreed', description: '', decide_by: expect.any(Date) }])
  expect(await notes(id, 'dispute-opened')).toEqual([U.cust, U.owner].sort())
  expect(await refusal(answer(U.cust, id, true, new Date(startAt.getTime() + 4 * HOUR)))).toEqual({ status: 409, body: { error: 'not-open' } })
  await runDueTimers(db, new Date(startAt.getTime() + 30 * DAY))
  expect(await ledger(id)).toEqual([])
  expect((await row(id)).status).toBe('disputed')
})

it("the customer's agreement is kept when the payout fails, and the timer pays it", async () => {
  const { id, startAt } = await paidBooking({ provider: bareProviderId, startAt: new Date('2027-09-27T08:00:00Z') })
  await stop(U.bare, id, new Date(startAt.getTime() + HOUR))
  await state(U.bare, id, 40, new Date(startAt.getTime() + HOUR))
  const now = new Date(startAt.getTime() + 2 * HOUR)
  const b = await answer(U.cust, id, true, now) // no payout account: the release fails
  expect(b.status).toBe('stopped')
  expect((await row(id)).confirm_by.getTime()).toBe(now.getTime()) // the agreement is recorded
  expect((await pool.query("SELECT note FROM staff_flags WHERE kind = 'payment-unprocessed' AND ref_id = $1", [id])).rows).toEqual([{ note: 'release failed: NO_PAYOUT_ACCOUNT' }])
  // the silence rule never sends an agreed amount to staff
  expect((await runDueTimers(db, new Date(now.getTime() + 8 * DAY))).stopsToStaff).toBe(0)
  await pool.query("UPDATE providers SET stripe_account_id = 'acct_dp_2' WHERE id = $1", [bareProviderId])
  try {
    expect((await runDueTimers(db, new Date(now.getTime() + 9 * DAY))).autoReleased).toBe(1)
  } finally {
    await pool.query('UPDATE providers SET stripe_account_id = NULL WHERE id = $1', [bareProviderId])
  }
  expect((await row(id)).status).toBe('completed')
  expect(await ledger(id)).toEqual([
    { kind: 'commission', amount: '4.80' },
    { kind: 'refund', amount: '60.00' },
    { kind: 'transfer', amount: '35.20' },
  ])
})

it('a stated amount unanswered for 7 days goes to staff; a stop never stated too', async () => {
  const S = new Date('2027-10-04T08:00:00Z')
  const { id } = await paidBooking({ startAt: S })
  await stop(U.cust, id, new Date(S.getTime() + HOUR))
  const statedAt = new Date(S.getTime() + 2 * HOUR)
  await state(U.owner, id, 30, statedAt)
  expect((await runDueTimers(db, new Date(statedAt.getTime() + 7 * DAY - MIN))).stopsToStaff).toBe(0)
  expect((await runDueTimers(db, new Date(statedAt.getTime() + 7 * DAY))).stopsToStaff).toBe(1)
  expect((await runDueTimers(db, new Date(statedAt.getTime() + 7 * DAY + HOUR))).stopsToStaff).toBe(0)
  expect(await disputesOf(id)).toEqual([{ opened_by: null, reason: 'no-response', description: '', decide_by: expect.any(Date) }])
  expect((await row(id)).status).toBe('disputed')
  expect(await notes(id, 'dispute-opened')).toEqual([U.cust, U.owner].sort())
  expect(await refusal(answer(U.cust, id, true, new Date(statedAt.getTime() + 8 * DAY)))).toEqual({ status: 409, body: { error: 'not-open' } })

  // the provider never states an amount: 7 days after the stop it goes to staff as well
  const n = await paidBooking({ startAt: new Date(S.getTime() + 3 * HOUR) })
  const stoppedAt = new Date(S.getTime() + 4 * HOUR)
  await stop(U.cust, n.id, stoppedAt)
  expect((await runDueTimers(db, new Date(stoppedAt.getTime() + 7 * DAY))).stopsToStaff).toBe(1)
  expect((await row(n.id)).status).toBe('disputed')
})

it('stop answer racing the 7-day timer: exactly one outcome', async () => {
  const S = new Date(Date.now() - 10 * DAY)
  const { id } = await paidBooking({ startAt: S })
  await stop(U.cust, id, new Date(S.getTime() + HOUR))
  await state(U.owner, id, 40, new Date(S.getTime() + 2 * HOUR))
  const holder = await pool.connect()
  let both: Promise<[Awaited<ReturnType<typeof refusal>>, Awaited<ReturnType<typeof runDueTimers>>]>
  try {
    await holder.query('BEGIN')
    await holder.query('SELECT 1 FROM bookings WHERE id = $1 FOR UPDATE', [id])
    both = Promise.all([refusal(answer(U.cust, id, true, new Date())), runDueTimers(db, new Date())])
    await new Promise((ok) => setTimeout(ok, 400))
    await holder.query('COMMIT')
  } finally {
    holder.release()
  }
  const [answered] = await both!
  const status = (await row(id)).status
  if (status === 'disputed') {
    expect(answered).toEqual({ status: 409, body: { error: 'not-open' } })
    expect(await ledger(id)).toEqual([])
  } else {
    expect(status).toBe('completed')
    expect(answered.status).toBe(0)
    expect(await disputesOf(id)).toEqual([])
    expect(g.attempts.transfer).toBe(1)
  }
})

it('staff can read the thread of a disputed booking', async () => {
  const { id, startAt } = await paidBooking({ startAt: new Date('2027-10-11T08:00:00Z'), finishedAt: new Date('2027-10-11T10:00:00Z') })
  const thread = (await pool.query('INSERT INTO threads (booking_id, customer_id, provider_id) VALUES ($1, $2, $3) RETURNING id', [id, U.cust, providerId])).rows[0].id
  expect(await staffMayReadThread(db, thread)).toBe(false)
  await dispute(U.cust, id, new Date(startAt.getTime() + DAY))
  expect(await staffMayReadThread(db, thread)).toBe(true)

  // a dispute on one of its additional tasks opens the original's thread too
  const root = await paidBooking({ startAt: new Date('2027-10-12T08:00:00Z') })
  const rootThread = (await pool.query('INSERT INTO threads (booking_id, customer_id, provider_id) VALUES ($1, $2, $3) RETURNING id', [root.id, U.cust, providerId])).rows[0].id
  const kid = await paidBooking({ startAt: new Date('2027-10-12T10:00:00Z'), finishedAt: new Date('2027-10-12T11:00:00Z'), parent: root.id })
  expect(await staffMayReadThread(db, rootThread)).toBe(false)
  await dispute(U.cust, kid.id, new Date('2027-10-13T08:00:00Z'))
  expect(await staffMayReadThread(db, rootThread)).toBe(true)
})

it('decideBy skips weekends', async () => {
  // Friday 2 July 2027, 10:00 in Berlin: 14 working days later is Thursday 22 July, 10:00
  const now = new Date('2027-07-02T08:00:00Z')
  const { id } = await paidBooking({ startAt: new Date('2027-07-01T08:00:00Z'), finishedAt: new Date('2027-07-01T10:00:00Z') })
  expect((await dispute(U.cust, id, now)).decideBy).toBe('2027-07-22T08:00:00.000Z')
})

it('a dispute past decideBy raises one dispute-overdue flag', async () => {
  const T = new Date('2027-11-01T08:00:00Z')
  const { id } = await paidBooking({ startAt: new Date(T.getTime() - 2 * HOUR), finishedAt: T })
  const d = await dispute(U.cust, id, new Date(T.getTime() + DAY))
  const flags = async () => (await pool.query("SELECT ref_id, resolved_at FROM staff_flags WHERE kind = 'dispute-overdue' AND ref_id = $1", [id])).rows
  expect((await runDueTimers(db, new Date(new Date(d.decideBy).getTime() - MIN))).overdueDisputes).toBe(0)
  expect((await runDueTimers(db, new Date(d.decideBy))).overdueDisputes).toBe(1)
  expect((await runDueTimers(db, new Date(new Date(d.decideBy).getTime() + DAY))).overdueDisputes).toBe(0)
  expect(await flags()).toEqual([{ ref_id: id, resolved_at: null }])
  await pool.query("UPDATE staff_flags SET resolved_at = now() WHERE kind = 'dispute-overdue' AND ref_id = $1", [id])
  expect((await runDueTimers(db, new Date(new Date(d.decideBy).getTime() + 2 * DAY))).overdueDisputes).toBe(0) // once
})

it('a silent provider is flagged 14 days after the ignored-requests notice, once', async () => {
  const N = new Date('2027-12-01T08:00:00Z')
  const flags = async (p: string) => (await pool.query("SELECT ref_id, user_id FROM staff_flags WHERE kind = 'ignored-requests' AND ref_id = $1", [p])).rows
  for (const u of [U.quiet, U.busy]) await pool.query("INSERT INTO notifications (user_id, kind, payload, created_at) VALUES ($1, 'requests-ignored', '{}', $2)", [u, N])
  // the busy provider sent a quote after the notice
  const req = (await pool.query("INSERT INTO requests (customer_id, provider_id, description, answer_by, status) VALUES ($1, $2, 'Hecke', $3, 'quoted') RETURNING id", [U.cust, busyProviderId, new Date(N.getTime() + 3 * DAY)])).rows[0].id
  await pool.query("INSERT INTO quotes (request_id, provider_id, amount, scope, expires_at, created_at) VALUES ($1, $2, 50, 'Hecke', $3, $4)", [req, busyProviderId, new Date(N.getTime() + 7 * DAY), new Date(N.getTime() + DAY)])
  expect((await runDueTimers(db, new Date(N.getTime() + 14 * DAY - MIN))).ignoredNoticeFlags).toBe(0)
  expect((await runDueTimers(db, new Date(N.getTime() + 14 * DAY))).ignoredNoticeFlags).toBe(1)
  expect(await flags(quietProviderId)).toEqual([{ ref_id: quietProviderId, user_id: U.quiet }])
  expect(await flags(busyProviderId)).toEqual([])
  await pool.query("UPDATE staff_flags SET resolved_at = now() WHERE kind = 'ignored-requests' AND ref_id = $1", [quietProviderId])
  expect((await runDueTimers(db, new Date(N.getTime() + 20 * DAY))).ignoredNoticeFlags).toBe(0) // once per notice
  expect((await pool.query('SELECT status FROM providers WHERE id = $1', [quietProviderId])).rows[0].status).toBe('published') // nothing removed
})

it('the no-response step and a no-show objection open a dispute that both sides and staff see', async () => {
  // the provider never tapped Finished: asked after 24 hours, then 7 days after the end it goes to staff
  const S = new Date('2028-01-03T08:00:00Z')
  const { id } = await paidBooking({ startAt: S })
  await runDueTimers(db, new Date(S.getTime() + 2 * DAY))
  expect((await runDueTimers(db, new Date(S.getTime() + 8 * DAY))).sentToStaff).toBe(1)
  expect(await disputesOf(id)).toEqual([{ opened_by: null, reason: 'no-response', description: '', decide_by: expect.any(Date) }])
  expect(await notes(id, 'dispute-opened')).toEqual([U.cust, U.owner].sort())

  const o = await paidBooking({ startAt: new Date(S.getTime() + 3 * HOUR) })
  const at = new Date(S.getTime() + 4 * HOUR)
  await asUser(U.cust, (tx) => reportNoShow(tx, U.cust, o.id, at))
  await asUser(U.owner, (tx) => objectNoShow(tx, U.owner, o.id, { description: 'Ich war pünktlich da.' }, at))
  expect(await notes(o.id, 'dispute-opened')).toEqual([U.cust, U.owner].sort())
  expect((await pool.query("SELECT count(*)::int n FROM disputes WHERE booking_id = ANY($1) AND decided_at IS NULL", [[id, o.id]])).rows[0].n).toBe(2) // in the staff queue
})

it('a chargeback on money not yet released opens a system dispute, once on replay', async () => {
  const ref = `pi_dp_cb_${randomUUID()}`
  const { id } = await paidBooking({ startAt: new Date('2028-02-07T08:00:00Z'), paymentRef: ref })
  const e = { id: `evt_${randomUUID()}`, type: 'charge-disputed', paymentRef: ref } as const
  await handleGatewayEvent(e)
  await handleGatewayEvent(e) // the same event again
  await handleGatewayEvent({ ...e, id: `evt_${randomUUID()}` }) // a second event for the same payment
  expect(await disputesOf(id)).toEqual([{ opened_by: null, reason: 'chargeback', description: '', decide_by: expect.any(Date) }])
  expect((await row(id)).status).toBe('disputed')
  expect((await pool.query("SELECT count(*)::int n FROM staff_flags WHERE kind = 'chargeback' AND ref_id = $1", [id])).rows[0].n).toBe(1)
  expect(await notes(id, 'dispute-opened')).toEqual([U.cust, U.owner].sort())

  // money already released: the flag only (staff handle it by hand)
  const ref2 = `pi_dp_cb_${randomUUID()}`
  const done = await paidBooking({ startAt: new Date('2028-02-08T08:00:00Z'), paymentRef: ref2 })
  await pool.query("UPDATE bookings SET status = 'completed', released_at = now() WHERE id = $1", [done.id])
  await handleGatewayEvent({ id: `evt_${randomUUID()}`, type: 'charge-disputed', paymentRef: ref2 })
  expect(await disputesOf(done.id)).toEqual([])
  expect((await row(done.id)).status).toBe('completed')
  expect((await pool.query("SELECT count(*)::int n FROM staff_flags WHERE kind = 'chargeback' AND ref_id = $1", [done.id])).rows[0].n).toBe(1)
})

it('a chargeback on a cancelled, unsettled booking only flags it; settle stays frozen', async () => {
  const ref = `pi_dp_cb_${randomUUID()}`
  const { id } = await paidBooking({ startAt: new Date('2028-02-14T08:00:00Z'), paymentRef: ref })
  await pool.query("UPDATE bookings SET status = 'cancelled', cancelled_at = '2028-02-10T08:00:00Z', cancelled_by = 'provider' WHERE id = $1", [id])
  await handleGatewayEvent({ id: `evt_${randomUUID()}`, type: 'charge-disputed', paymentRef: ref })
  expect((await row(id)).status).toBe('cancelled')
  expect(await disputesOf(id)).toEqual([])
  expect((await pool.query("SELECT count(*)::int n FROM staff_flags WHERE kind = 'chargeback' AND ref_id = $1 AND resolved_at IS NULL", [id])).rows[0].n).toBe(1)
  await runDueTimers(db, new Date('2028-02-15T08:00:00Z'))
  expect((await row(id)).released_at).toBeNull()
  expect(await ledger(id)).toEqual([])
  expect(g.calls).toEqual([])
})

it('a suspended customer can still open a dispute', async () => {
  const T = new Date(Date.now() - DAY)
  const { id } = await paidBooking({ startAt: new Date(T.getTime() - 2 * HOUR), finishedAt: T })
  await pool.query("UPDATE users SET suspended_until = now() + interval '30 days' WHERE id = $1", [U.cust])
  try {
    expect((await call(disputeRoute.POST, U.cust, 'POST', { description: 'Nicht fertig geworden.' }, { id })).status).toBe(200)
  } finally {
    await pool.query('UPDATE users SET suspended_until = NULL WHERE id = $1', [U.cust])
  }
  expect((await row(id)).status).toBe('disputed')
})

it('a stop agreed at 0 is a full refund: refunded, no payout, no review requests', async () => {
  const { id, startAt } = await paidBooking()
  const at = new Date(startAt.getTime() + 10 * MIN)
  await stop(U.cust, id, at)
  await state(U.owner, id, 0, at)
  await answer(U.cust, id, true, at)
  expect(await row(id)).toMatchObject({ status: 'refunded' })
  expect(await ledger(id)).toEqual([{ kind: 'refund', amount: '100.00' }])
  expect(await notes(id, 'review-requested')).toEqual([])
  expect(await notes(id, 'payment-released')).toEqual([U.cust, U.owner].sort())
  expect(outboxForTests().some((m) => m.to === EMAIL(U.owner) && m.text.includes('nothing is paid out'))).toBe(true)
  // a second answer changes nothing
  await answer(U.cust, id, true, at)
  expect(await ledger(id)).toEqual([{ kind: 'refund', amount: '100.00' }])
})
