import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { asUser, db, pool } from '@kando/db'
import { clearOutbox, confirmJob, finishJob, outboxForTests, releaseBooking, runDueTimers, runExpiryAndReminders, runMoneySteps, setGatewayForTests } from '@kando/domain'
import { call, cleanupUsers, EMAIL, seedBase, seedProvider, seedUser } from './helpers'
import { appConnectionsAtMoneyCalls, fakeGateway, type FakeGateway } from './fake-gateway'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const finishRoute = await import('../app/app-api/v1/bookings/[id]/finish/route')
const confirmRoute = await import('../app/app-api/v1/bookings/[id]/confirm/route')

const U = { cust: 'fn-cust', owner: 'fn-owner', bare: 'fn-bare', third: 'fn-third' }
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
let providerId: string, bareProviderId: string
let g: FakeGateway
let slot = 0

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  await seedUser(U.cust)
  await seedUser(U.third)
  providerId = await seedProvider(U.owner, { name: 'Fn Owner', categoryId, price: 100 })
  bareProviderId = await seedProvider(U.bare, { name: 'Fn Bare', categoryId, price: 100 })
  await pool.query("UPDATE providers SET stripe_account_id = 'acct_fn_1' WHERE id = $1", [providerId])
})
beforeEach(async () => {
  vi.stubEnv('PAYMENTS_ENABLED', 'true')
  g = fakeGateway()
  setGatewayForTests(g)
  clearOutbox()
  // every test sees only its own bookings in a sweep
  await pool.query("DELETE FROM notifications WHERE user_id LIKE 'fn-%'")
  await pool.query("DELETE FROM staff_flags WHERE user_id LIKE 'fn-%'")
  await pool.query("DELETE FROM disputes WHERE booking_id IN (SELECT id FROM bookings WHERE customer_id = 'fn-cust')")
  await pool.query("UPDATE bookings SET status = 'expired' WHERE customer_id = 'fn-cust' AND status IN ('confirmed', 'finished', 'disputed')")
})
afterEach(() => {
  setGatewayForTests(undefined)
  vi.unstubAllEnvs()
})
afterAll(cleanupUsers)

/** A paid, confirmed booking (as the payment webhook leaves it), starting at `startAt`, 60 minutes, 100 EUR, its charge row. */
async function paidBooking(o: { startAt?: Date; provider?: string; status?: string; finishedAt?: Date } = {}): Promise<{ id: string; startAt: Date }> {
  const p = o.provider ?? providerId
  const startAt = o.startAt ?? new Date(Date.now() - 2 * HOUR - ++slot * 3 * HOUR)
  const service = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [p])).rows[0].id
  const finishedAt = o.finishedAt ?? null
  const id = (
    await pool.query(
      `INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, pay_by, paid_at, payment_ref, commission_rate, finished_at, confirm_by)
       VALUES ($1, $2, $3, 'direct', $4, $5, 60, $5::timestamptz - interval '2 days', $5::timestamptz - interval '2 days', 'pi_fn_' || gen_random_uuid(), 0.12, $6::timestamptz, $6::timestamptz + interval '7 days') RETURNING id`,
      [U.cust, p, service, o.status ?? 'confirmed', startAt, finishedAt],
    )
  ).rows[0].id as string
  await pool.query("INSERT INTO ledger_entries (booking_id, provider_id, kind, amount, idempotency_key) VALUES ($1, $2, 'charge', 100, $3)", [id, p, `charge:${id}`])
  return { id, startAt }
}

const row = async (id: string) =>
  (await pool.query('SELECT status, finished_at, confirm_by, confirm_reminders_sent, asked_done_at, completed_at, released_at, material_amount FROM bookings WHERE id = $1', [id])).rows[0]
const ledger = async (id: string) => (await pool.query("SELECT kind, amount FROM ledger_entries WHERE booking_id = $1 AND kind <> 'charge' ORDER BY kind", [id])).rows
const notes = async (id: string) => (await pool.query("SELECT user_id, kind FROM notifications WHERE payload->>'bookingId' = $1 ORDER BY kind, user_id", [id])).rows
const callsOf = (method: string) => g.calls.filter((c) => c.method === method)
const refusal = (p: Promise<unknown>) =>
  p.then(
    () => ({ status: 0, body: null }),
    async (e: unknown) => (e instanceof Response ? { status: e.status, body: await e.json() } : Promise.reject(e)),
  )
const finish = (userId: string, id: string, now: Date, input: { materialAmount?: number } = {}) => asUser(userId, (tx) => finishJob(tx, userId, id, input, now))
const confirm = (userId: string, id: string, now: Date) => asUser(userId, (tx) => confirmJob(tx, userId, id, now))

it('Finished before the start is 409; after it the 7-day clock starts', async () => {
  const startAt = new Date(Date.now() + 3 * DAY)
  const { id } = await paidBooking({ startAt })
  expect(await refusal(finish(U.owner, id, new Date(startAt.getTime() - MIN)))).toEqual({ status: 409, body: { error: 'TOO_EARLY' } })
  expect((await row(id)).status).toBe('confirmed')
  const done = await finish(U.owner, id, startAt, { materialAmount: 12.5 })
  expect(done).toMatchObject({ status: 'finished', finishedAt: startAt.toISOString(), confirmBy: new Date(startAt.getTime() + 7 * DAY).toISOString() })
  const r = await row(id)
  expect(r).toMatchObject({ status: 'finished', material_amount: '12.50', confirm_reminders_sent: 0 })
  expect(r.finished_at.getTime()).toBe(startAt.getTime())
  expect(r.confirm_by.getTime()).toBe(startAt.getTime() + 7 * DAY)
  expect(await notes(id)).toEqual([{ user_id: U.cust, kind: 'job-finished' }])
  const mail = outboxForTests().find((m) => m.to === EMAIL(U.cust))!
  expect(mail.text).toMatch(/\d{2}[./]\d{2}[./]\d{4}/) // names the release date
})

it('Finished twice is 409', async () => {
  const { id, startAt } = await paidBooking()
  await finish(U.owner, id, startAt)
  const before = await row(id)
  expect(await refusal(finish(U.owner, id, new Date(startAt.getTime() + HOUR)))).toEqual({ status: 409, body: { error: 'not-open' } })
  expect((await row(id)).confirm_by.getTime()).toBe(before.confirm_by.getTime()) // no second clock
  expect(await notes(id)).toHaveLength(1)
})

it('a third person gets 404, the customer cannot finish, the provider cannot confirm', async () => {
  const { id } = await paidBooking()
  expect((await call(finishRoute.POST, U.third, 'POST', {}, { id })).status).toBe(404)
  expect((await call(finishRoute.POST, U.cust, 'POST', {}, { id })).status).toBe(403)
  expect((await call(confirmRoute.POST, U.third, 'POST', undefined, { id })).status).toBe(404)
  expect((await call(finishRoute.POST, U.owner, 'POST', {}, { id })).status).toBe(200)
  expect((await call(confirmRoute.POST, U.owner, 'POST', undefined, { id })).status).toBe(403)
  expect((await row(id)).status).toBe('finished')
})

it('a material amount that is negative, above the price or in fractions of cents is 400', async () => {
  const { id, startAt } = await paidBooking()
  expect((await call(finishRoute.POST, U.owner, 'POST', { materialAmount: -1 }, { id })).status).toBe(400)
  expect((await call(finishRoute.POST, U.owner, 'POST', { materialAmount: 1.005 }, { id })).status).toBe(400)
  expect(await refusal(finish(U.owner, id, startAt, { materialAmount: 100.01 }))).toEqual({ status: 400, body: { error: 'INVALID_MATERIAL_AMOUNT' } })
  expect((await row(id)).status).toBe('confirmed')
  expect((await finish(U.owner, id, startAt, { materialAmount: 100 })).status).toBe('finished')
})

it('reminders after 1, 3 and 6 days, each once', async () => {
  const T = new Date('2027-05-03T10:00:00Z')
  const { id } = await paidBooking({ status: 'finished', startAt: new Date(T.getTime() - 2 * HOUR), finishedAt: T })
  const at = (ms: number) => runDueTimers(db, new Date(T.getTime() + ms))
  expect((await at(DAY - MIN)).confirmReminders).toBe(0)
  expect((await at(DAY)).confirmReminders).toBe(1)
  expect((await at(DAY + HOUR)).confirmReminders).toBe(0)
  expect((await at(3 * DAY - MIN)).confirmReminders).toBe(0)
  expect((await at(3 * DAY)).confirmReminders).toBe(1)
  expect((await at(6 * DAY)).confirmReminders).toBe(1)
  expect((await at(6 * DAY + 23 * HOUR)).confirmReminders).toBe(0)
  expect((await row(id)).confirm_reminders_sent).toBe(3)
  expect((await notes(id)).filter((n) => n.kind === 'confirm-reminder')).toHaveLength(3)
  const mails = outboxForTests().filter((m) => m.to === EMAIL(U.cust))
  expect(mails).toHaveLength(3)
  expect(mails[0]!.text).toContain('10.05.2027') // the payment date (confirmBy, Berlin time)

  // a late run (cron down for 5 days) sends one, the next run the next: none skipped silently
  const late = await paidBooking({ status: 'finished', startAt: new Date(T.getTime() - 2 * HOUR), finishedAt: T })
  expect((await at(5 * DAY)).confirmReminders).toBe(1)
  expect((await row(late.id)).confirm_reminders_sent).toBe(1)
  expect((await at(5 * DAY)).confirmReminders).toBe(1)
  expect((await at(5 * DAY)).confirmReminders).toBe(0)
})

it('the customer confirms: one transfer, one commission row, status completed, both told', async () => {
  const { id, startAt } = await paidBooking()
  await finish(U.owner, id, startAt)
  const now = new Date(startAt.getTime() + 2 * HOUR)
  const done = await confirm(U.cust, id, now)
  expect(done.status).toBe('completed')
  expect(await ledger(id)).toEqual([
    { kind: 'commission', amount: '12.00' },
    { kind: 'transfer', amount: '88.00' },
  ])
  expect(callsOf('transfer')).toHaveLength(1)
  expect(callsOf('refund')).toHaveLength(0)
  const r = await row(id)
  expect(r.status).toBe('completed')
  expect(r.completed_at.getTime()).toBe(now.getTime())
  expect(r.released_at).not.toBeNull()
  expect(await notes(id)).toEqual([
    { user_id: U.cust, kind: 'job-finished' },
    { user_id: U.cust, kind: 'payment-released' },
    { user_id: U.owner, kind: 'payment-released' },
    { user_id: U.cust, kind: 'review-requested' },
    { user_id: U.owner, kind: 'review-requested' },
  ])
  const sum = (await pool.query("SELECT sum(amount) FILTER (WHERE kind = 'charge') c, sum(amount) FILTER (WHERE kind <> 'charge') o FROM ledger_entries WHERE booking_id = $1", [id])).rows[0]
  expect(sum.o).toBe(sum.c) // the money out sums to the charge

  // a second tap: the same completed booking, nothing moves again
  expect((await confirm(U.cust, id, new Date(now.getTime() + MIN))).status).toBe('completed')
  expect(g.attempts.transfer).toBe(1)
  expect(await notes(id)).toHaveLength(5)
})

it('a suspended customer can still confirm', async () => {
  const { id } = await paidBooking()
  await call(finishRoute.POST, U.owner, 'POST', {}, { id })
  await pool.query("UPDATE users SET suspended_until = now() + interval '1 day' WHERE id = $1", [U.cust])
  try {
    const res = await call(confirmRoute.POST, U.cust, 'POST', undefined, { id })
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('completed')
  } finally {
    await pool.query('UPDATE users SET suspended_until = NULL WHERE id = $1', [U.cust])
  }
})

it('the confirm route pays out with no request transaction open', async () => {
  const { id } = await paidBooking()
  expect((await call(finishRoute.POST, U.owner, 'POST', {}, { id })).status).toBe(200)
  const open = appConnectionsAtMoneyCalls(g)
  const res = await call(confirmRoute.POST, U.cust, 'POST', undefined, { id })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ id, status: 'completed' })
  expect(open).toEqual([0])
})

it('7 days of silence release automatically', async () => {
  const T = new Date('2027-06-01T10:00:00Z')
  const { id } = await paidBooking({ status: 'finished', startAt: new Date(T.getTime() - 2 * HOUR), finishedAt: T })
  await pool.query('UPDATE bookings SET confirm_reminders_sent = 3 WHERE id = $1', [id])
  expect((await runDueTimers(db, new Date(T.getTime() + 7 * DAY - MIN))).autoReleased).toBe(0)
  expect((await row(id)).status).toBe('finished')
  expect((await runDueTimers(db, new Date(T.getTime() + 7 * DAY))).autoReleased).toBe(1)
  expect((await row(id)).status).toBe('completed')
  expect(callsOf('transfer')).toHaveLength(1)
  expect((await notes(id)).map((n) => n.kind)).toEqual(['payment-released', 'payment-released', 'review-requested', 'review-requested'])
  expect((await runDueTimers(db, new Date(T.getTime() + 8 * DAY))).autoReleased).toBe(0)
})

it('confirm racing the timer settles once', async () => {
  const T = new Date(Date.now() - 8 * DAY)
  const { id } = await paidBooking({ status: 'finished', startAt: new Date(T.getTime() - 2 * HOUR), finishedAt: T })
  await pool.query('UPDATE bookings SET confirm_reminders_sent = 3 WHERE id = $1', [id])
  const now = new Date()
  // hold the booking row: both must wait for it, then exactly one settles
  const errors = vi.spyOn(console, 'error')
  const holder = await pool.connect()
  let both: Promise<[Awaited<ReturnType<typeof confirm>>, Awaited<ReturnType<typeof runDueTimers>>]>
  try {
    await holder.query('BEGIN')
    await holder.query('SELECT 1 FROM bookings WHERE id = $1 FOR UPDATE', [id])
    both = Promise.all([confirm(U.cust, id, now), runDueTimers(db, now)])
    await new Promise((ok) => setTimeout(ok, 500))
    expect(await ledger(id)).toEqual([])
    await holder.query('COMMIT')
  } finally {
    holder.release()
  }
  const [confirmed, report] = await both!
  expect(confirmed.status).toBe('completed') // both resolved: whichever came second found it completed and stopped quietly
  expect(report.autoReleased).toBe(1) // the timer either released it or found it completed (never a refusal)
  expect((await row(id)).status).toBe('completed')
  expect((await pool.query('SELECT count(*)::int n FROM staff_flags WHERE ref_id = $1', [id])).rows[0].n).toBe(0)
  // the second one returned quietly: no refusal was logged (without the `completed` early return it is a logged not-open)
  expect(errors.mock.calls.filter((c) => String(c[0]).startsWith('[release]'))).toEqual([])
  errors.mockRestore()
  expect(await ledger(id)).toEqual([
    { kind: 'commission', amount: '12.00' },
    { kind: 'transfer', amount: '88.00' },
  ])
  expect(g.attempts.transfer).toBe(1)
  expect((await notes(id)).filter((n) => n.kind === 'payment-released')).toEqual([
    { user_id: U.cust, kind: 'payment-released' },
    { user_id: U.owner, kind: 'payment-released' },
  ])
})

it('a booking with an open dispute is skipped by the timer', async () => {
  const T = new Date('2027-07-01T10:00:00Z')
  const { id } = await paidBooking({ status: 'finished', startAt: new Date(T.getTime() - 2 * HOUR), finishedAt: T })
  await pool.query("INSERT INTO disputes (booking_id, opened_by, reason, description, decide_by) VALUES ($1, 'customer', 'problem', 'x', now() + interval '20 days')", [id])
  const report = await runDueTimers(db, new Date(T.getTime() + 8 * DAY))
  expect(report.autoReleased).toBe(0)
  expect(report.confirmReminders).toBe(0)
  expect((await row(id)).status).toBe('finished')
  expect(g.calls).toEqual([])
})

it('NO_PAYOUT_ACCOUNT: the confirmation is kept, staff are told, and the timer releases once the account exists', async () => {
  const { id, startAt } = await paidBooking({ provider: bareProviderId })
  await finish(U.bare, id, startAt)
  const now = new Date(startAt.getTime() + HOUR)
  const r = await confirm(U.cust, id, now)
  expect(r.status).toBe('finished') // the click is recorded: the release is due now
  expect(new Date(r.confirmBy!).getTime()).toBe(now.getTime())
  expect((await row(id)).released_at).toBeNull()
  expect((await pool.query("SELECT note FROM staff_flags WHERE kind = 'payment-unprocessed' AND ref_id = $1", [id])).rows).toEqual([{ note: 'release failed: NO_PAYOUT_ACCOUNT' }])
  expect((await runDueTimers(db, new Date(now.getTime() + MIN))).autoReleased).toBe(0) // still no account
  await pool.query("UPDATE providers SET stripe_account_id = 'acct_fn_bare' WHERE id = $1", [bareProviderId])
  try {
    expect((await runDueTimers(db, new Date(now.getTime() + DAY))).autoReleased).toBe(1)
    expect((await row(id)).status).toBe('completed')
    // one flag, not one per run, resolved by the successful release
    expect((await pool.query('SELECT resolved_at IS NOT NULL AS resolved, resolved_by FROM staff_flags WHERE ref_id = $1', [id])).rows).toEqual([{ resolved: true, resolved_by: 'system' }])
  } finally {
    await pool.query('UPDATE providers SET stripe_account_id = NULL WHERE id = $1', [bareProviderId])
  }
})

it('a gateway failure leaves the booking finished and the next run releases it', async () => {
  const T = new Date('2027-08-02T10:00:00Z')
  const { id } = await paidBooking({ status: 'finished', startAt: new Date(T.getTime() - 2 * HOUR), finishedAt: T })
  const other = await paidBooking({ status: 'finished', startAt: new Date(T.getTime() - 4 * HOUR), finishedAt: new Date(T.getTime() + MIN) })
  await pool.query('UPDATE bookings SET confirm_reminders_sent = 3 WHERE id = ANY($1)', [[id, other.id]])
  const transfer = g.transfer
  g.transfer = async (args) => {
    if (args.bookingId === id) throw new Error('gateway down')
    return transfer(args)
  }
  const first = await runDueTimers(db, new Date(T.getTime() + 8 * DAY))
  expect(first.autoReleased).toBe(1) // the other booking: one failure never stops the sweep
  expect((await row(id))).toMatchObject({ status: 'finished', released_at: null })
  expect((await row(other.id)).status).toBe('completed')
  expect(await ledger(id)).toEqual([])
  g.transfer = transfer
  expect((await runDueTimers(db, new Date(T.getTime() + 8 * DAY + HOUR))).autoReleased).toBe(1)
  expect((await row(id)).status).toBe('completed')
})

it('a crash between settle and the status update is repaired by a retry without moving money twice', async () => {
  const T = new Date('2027-09-01T10:00:00Z')
  const { id } = await paidBooking({ status: 'finished', startAt: new Date(T.getTime() - 2 * HOUR), finishedAt: T })
  await pool.query(`CREATE OR REPLACE FUNCTION fn_test_crash() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'crash before completed'; END $$`)
  await pool.query(`CREATE TRIGGER fn_test_crash BEFORE UPDATE ON bookings FOR EACH ROW WHEN (NEW.status = 'completed' AND NEW.id = '${id}') EXECUTE FUNCTION fn_test_crash()`)
  try {
    await expect(releaseBooking(db, id, new Date(T.getTime() + 8 * DAY))).rejects.toThrow(/Failed query: update "bookings"/) // the injected crash on the status update
  } finally {
    await pool.query('DROP TRIGGER fn_test_crash ON bookings')
    await pool.query('DROP FUNCTION fn_test_crash()')
  }
  // the transfer happened and its row survived; the commission, released_at and the status rolled back together
  expect(await ledger(id)).toEqual([{ kind: 'transfer', amount: '88.00' }])
  expect(await row(id)).toMatchObject({ status: 'finished', released_at: null })
  await releaseBooking(db, id, new Date(T.getTime() + 8 * DAY))
  expect((await row(id)).status).toBe('completed')
  expect(await ledger(id)).toEqual([
    { kind: 'commission', amount: '12.00' },
    { kind: 'transfer', amount: '88.00' },
  ])
  expect(g.attempts.transfer).toBe(1) // the retry skipped the transfer: no second payout
  expect(callsOf('refund')).toHaveLength(0)
})

it('24 hours after the end without Finished the customer is asked, once', async () => {
  const S = new Date('2027-10-04T08:00:00Z') // ends 09:00
  const { id } = await paidBooking({ startAt: S })
  const end = S.getTime() + HOUR
  expect((await runDueTimers(db, new Date(end + 24 * HOUR - MIN))).askedDone).toBe(0)
  expect((await runDueTimers(db, new Date(end + 24 * HOUR))).askedDone).toBe(1)
  expect((await runDueTimers(db, new Date(end + 48 * HOUR))).askedDone).toBe(0)
  expect((await row(id)).asked_done_at.getTime()).toBe(end + 24 * HOUR)
  expect(await notes(id)).toEqual([{ user_id: U.cust, kind: 'was-job-done' }])
  expect(outboxForTests().filter((m) => m.to === EMAIL(U.cust))).toHaveLength(1)
})

it('the customer confirms from that question', async () => {
  const S = new Date(Date.now() - 3 * DAY)
  const { id } = await paidBooking({ startAt: S })
  expect(await refusal(confirm(U.cust, id, new Date()))).toEqual({ status: 409, body: { error: 'not-open' } }) // not asked yet, not finished
  await runDueTimers(db, new Date())
  expect((await row(id)).asked_done_at).not.toBeNull()
  const done = await confirm(U.cust, id, new Date())
  expect(done.status).toBe('completed')
  expect(await ledger(id)).toEqual([
    { kind: 'commission', amount: '12.00' },
    { kind: 'transfer', amount: '88.00' },
  ])
})

it('7 days after the end with no action the booking goes to staff with a no-response dispute', async () => {
  const S = new Date('2027-11-08T08:00:00Z')
  const { id } = await paidBooking({ startAt: S })
  const end = S.getTime() + HOUR
  expect((await runDueTimers(db, new Date(end + DAY))).askedDone).toBe(1)
  expect((await runDueTimers(db, new Date(end + 7 * DAY - MIN))).sentToStaff).toBe(0)
  expect((await row(id)).status).toBe('confirmed')
  expect((await runDueTimers(db, new Date(end + 7 * DAY))).sentToStaff).toBe(1)
  expect((await runDueTimers(db, new Date(end + 8 * DAY))).sentToStaff).toBe(0)
  expect((await row(id)).status).toBe('disputed')
  const d = (await pool.query('SELECT opened_by, reason, decide_by, decided_at FROM disputes WHERE booking_id = $1', [id])).rows
  expect(d).toHaveLength(1)
  expect(d[0]).toMatchObject({ opened_by: null, reason: 'no-response', decided_at: null })
  expect(d[0].decide_by.getTime()).toBeGreaterThan(end + 7 * DAY)
  expect(g.calls).toEqual([]) // the money stays frozen
  expect(await refusal(confirm(U.cust, id, new Date(end + 8 * DAY)))).toEqual({ status: 409, body: { error: 'not-open' } })
})

it('a cron that was down never asks and escalates in the same run: staff get it 24 hours after the question', async () => {
  const S = new Date('2027-11-15T08:00:00Z')
  const { id } = await paidBooking({ startAt: S })
  const late = S.getTime() + HOUR + 10 * DAY
  expect(await runDueTimers(db, new Date(late))).toMatchObject({ askedDone: 1, sentToStaff: 0 })
  expect((await row(id)).status).toBe('confirmed')
  expect((await runDueTimers(db, new Date(late + 24 * HOUR - MIN))).sentToStaff).toBe(0)
  expect((await runDueTimers(db, new Date(late + 24 * HOUR))).sentToStaff).toBe(1)
  expect((await row(id)).status).toBe('disputed')
})

/** A clock for the release budget: every reading is `step` ms after the previous one. */
const ticking = (step: number) => {
  let t = 0
  return () => (t += step)
}

it('the time budget stops starting releases; the rest go in the next run', async () => {
  const T = new Date('2028-01-03T10:00:00Z')
  const ids: string[] = []
  for (let i = 0; i < 3; i++) ids.push((await paidBooking({ status: 'finished', startAt: new Date(T.getTime() - (i + 2) * HOUR), finishedAt: new Date(T.getTime() + i * MIN) })).id)
  await pool.query('UPDATE bookings SET confirm_reminders_sent = 3 WHERE id = ANY($1)', [ids])
  // the clock reads 1000 at the start, then 2000 and 3000 before the first two releases (1000 and 2000 used, inside 2500); 4000 stops the third
  expect((await runDueTimers(db, new Date(T.getTime() + 8 * DAY), { budgetMs: 2500, clock: ticking(1000) })).autoReleased).toBe(2)
  expect((await row(ids[2]!)).status).toBe('finished') // oldest first
  expect((await runDueTimers(db, new Date(T.getTime() + 8 * DAY), { budgetMs: 2500, clock: ticking(1000) })).autoReleased).toBe(1)
  expect((await pool.query("SELECT count(*)::int n FROM bookings WHERE id = ANY($1) AND status = 'completed'", [ids])).rows[0].n).toBe(3)
  expect(callsOf('transfer')).toHaveLength(3)
})

it('a booking whose release keeps failing goes last and never blocks a later one', async () => {
  const T = new Date('2028-02-01T10:00:00Z')
  const stuck = await paidBooking({ provider: bareProviderId, status: 'finished', startAt: new Date(T.getTime() - 2 * HOUR), finishedAt: T }) // no payout account
  const fine = await paidBooking({ status: 'finished', startAt: new Date(T.getTime() - 4 * HOUR), finishedAt: new Date(T.getTime() + HOUR) })
  await pool.query('UPDATE bookings SET confirm_reminders_sent = 3 WHERE id = ANY($1)', [[stuck.id, fine.id]])
  // run 1 (room for one release): the older one is tried first, fails and is flagged
  expect((await runDueTimers(db, new Date(T.getTime() + 8 * DAY), { budgetMs: 1500, clock: ticking(1000) })).autoReleased).toBe(0)
  expect((await pool.query("SELECT note FROM staff_flags WHERE kind = 'payment-unprocessed' AND ref_id = $1", [stuck.id])).rows).toEqual([{ note: 'release failed: NO_PAYOUT_ACCOUNT' }])
  // run 2 (room for one): the flagged one now comes last, so the other is released
  expect((await runDueTimers(db, new Date(T.getTime() + 8 * DAY), { budgetMs: 1500, clock: ticking(1000) })).autoReleased).toBe(1)
  expect((await row(fine.id)).status).toBe('completed')
  expect((await row(stuck.id)).status).toBe('finished')
})

it('a booking with an open chargeback flag is not picked by the release', async () => {
  const T = new Date('2028-03-01T10:00:00Z')
  const { id } = await paidBooking({ status: 'finished', startAt: new Date(T.getTime() - 2 * HOUR), finishedAt: T })
  await pool.query("INSERT INTO staff_flags (kind, ref_id, user_id, note) VALUES ('chargeback', $1, $2, 'test')", [id, U.cust])
  expect((await runDueTimers(db, new Date(T.getTime() + 8 * DAY))).autoReleased).toBe(0)
  expect(g.calls).toEqual([])
  expect((await pool.query("SELECT count(*)::int n FROM staff_flags WHERE kind = 'payment-unprocessed' AND ref_id = $1", [id])).rows[0].n).toBe(0) // not tried, so not flagged
})

it('the other rules and their emails happen even when the release loop fails (the rules and their emails run in their own step, before the money)', async () => {
  const T = new Date('2028-04-03T10:00:00Z')
  const reminded = await paidBooking({ status: 'finished', startAt: new Date(T.getTime() - 2 * HOUR), finishedAt: new Date(T.getTime() + 6 * DAY) }) // reminder 1 due at T + 7 d
  const asked = await paidBooking({ startAt: new Date(T.getTime() + 5 * DAY) }) // ends T + 5 d 1 h: asked at T + 7 d
  const released = await paidBooking({ status: 'finished', startAt: new Date(T.getTime() - 4 * HOUR), finishedAt: T }) // due at T + 7 d
  await pool.query('UPDATE bookings SET confirm_reminders_sent = 3 WHERE id = $1', [released.id])
  let reads = 0
  const boom = () => {
    if (reads++ === 0) return 0 // the run's start; then the release loop breaks
    throw new Error('release loop broke')
  }
  await runExpiryAndReminders(db, new Date(T.getTime() + 7 * DAY))
  await expect(runMoneySteps(db, new Date(T.getTime() + 7 * DAY), { clock: boom })).rejects.toThrow('release loop broke')
  expect((await row(reminded.id)).confirm_reminders_sent).toBe(1)
  expect((await row(asked.id)).asked_done_at).not.toBeNull()
  expect((await row(released.id)).status).toBe('finished')
  expect(outboxForTests().filter((m) => m.to === EMAIL(U.cust))).toHaveLength(2) // the reminder and the question went out
  // a budget used up before the first release: the same, without an error
  expect((await runDueTimers(db, new Date(T.getTime() + 7 * DAY), { budgetMs: 0 })).autoReleased).toBe(0)
  expect((await runDueTimers(db, new Date(T.getTime() + 7 * DAY))).autoReleased).toBe(1)
})

it("a step's time budget counts from that step's start: a no-show settled first can use it up before the releases", async () => {
  const T = new Date('2028-05-02T10:00:00Z')
  const reported = await paidBooking({ startAt: new Date(T.getTime() - 3 * DAY) })
  await pool.query("UPDATE bookings SET no_show = 'customer', no_show_reported_at = $2 WHERE id = $1", [reported.id, new Date(T.getTime() - 3 * DAY + HOUR)])
  const due = await paidBooking({ status: 'finished', startAt: new Date(T.getTime() - 9 * DAY), finishedAt: new Date(T.getTime() - 8 * DAY) })
  await pool.query('UPDATE bookings SET confirm_reminders_sent = 3 WHERE id = $1', [due.id])
  // the clock reads 1000 at the start and 2000 before the no-show (1000 used, inside 1500); the release sees 3000: over
  const report = await runDueTimers(db, T, { budgetMs: 1500, clock: ticking(1000) })
  expect(report.noShowsResolved).toBeGreaterThanOrEqual(1)
  expect((await row(reported.id)).status).toBe('cancelled')
  expect(report.autoReleased).toBe(0)
  expect((await row(due.id)).status).toBe('finished')
  await runDueTimers(db, T)
  expect((await row(due.id)).status).toBe('completed')
})
