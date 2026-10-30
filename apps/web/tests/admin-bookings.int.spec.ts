import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { asUser, db, pool } from '@kando/db'
import { clearOutbox, decideDispute, getPublicProfile, objectNoShow, openDispute, outboxForTests, reportNoShow, runDueTimers, setGatewayForTests, threadForBooking } from '@kando/domain'
import { adminCall, cleanupUsers, EMAIL, fakeSession, mockAuth, seedBase, seedProvider, seedUser } from './helpers'
import { fakeGateway, type FakeGateway } from './fake-gateway'

vi.mock('../lib/auth/server', async () => ({ ...(await mockAuth()), sessionFromRequest: fakeSession }))
const decideRoute = await import('../app/api/admin/disputes/[id]/decide/route')
const refundRoute = await import('../app/api/admin/bookings/[id]/refund/route')
const hideRoute = await import('../app/api/admin/reviews/[id]/hide/route')
const list = await import('../app/api/admin/[resource]/route')
const item = await import('../app/api/admin/[resource]/[id]/route')
const threadRoute = await import('../app/api/admin/threads/[id]/route')

const U = { admin: 'ab-admin', rev: 'ab-rev', cust: 'ab-cust', owner: 'ab-owner', bare: 'ab-bare' }
const HOUR = 3_600_000
const REASON = 'Die Arbeit war nur zur Hälfte gemacht.'
let providerId: string, bareProviderId: string, serviceId: string, slug: string
let g: FakeGateway
let slot = 0

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  await seedUser(U.admin, 'admin')
  await seedUser(U.rev, 'reviewer')
  await seedUser(U.cust, null, 'Anna Kundin')
  providerId = await seedProvider(U.owner, { name: 'Ab Owner', categoryId, price: 100 })
  bareProviderId = await seedProvider(U.bare, { name: 'Ab Bare', categoryId, price: 100 })
  await pool.query("UPDATE users SET language = 'en' WHERE id = ANY($1)", [[U.cust, U.owner]])
  await pool.query("UPDATE providers SET stripe_account_id = 'acct_ab_1' WHERE id = $1", [providerId])
  serviceId = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [providerId])).rows[0].id
  slug = (await pool.query('SELECT slug FROM providers WHERE id = $1', [providerId])).rows[0].slug
})
beforeEach(async () => {
  vi.stubEnv('PAYMENTS_ENABLED', 'true')
  g = fakeGateway()
  setGatewayForTests(g)
  clearOutbox()
  await pool.query("DELETE FROM notifications WHERE user_id LIKE 'ab-%'")
  await pool.query("DELETE FROM staff_flags WHERE user_id LIKE 'ab-%' OR ref_id = ANY($1)", [[providerId, bareProviderId]])
  // every test sees only its own bookings in a sweep
  await pool.query("UPDATE disputes SET decision = 'full-refund', provider_share = 0, decision_reason = 'test', decided_at = now() WHERE decided_at IS NULL AND booking_id IN (SELECT id FROM bookings WHERE customer_id = 'ab-cust')")
  await pool.query("UPDATE bookings SET status = 'expired' WHERE customer_id = 'ab-cust' AND status IN ('confirmed', 'finished', 'disputed', 'stopped')")
})
afterEach(() => {
  setGatewayForTests(undefined)
  vi.unstubAllEnvs()
})
afterAll(cleanupUsers)

/** A paid booking (as the payment webhook leaves it), 60 minutes, 100 EUR, with its charge row; `finishedAt` makes it finished. */
async function paidBooking(o: { startAt?: Date; provider?: string; finishedAt?: Date } = {}): Promise<{ id: string; startAt: Date }> {
  const p = o.provider ?? providerId
  const startAt = o.startAt ?? new Date(Date.now() - 2 * HOUR - ++slot * 3 * HOUR)
  const service = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [p])).rows[0].id
  const id = (
    await pool.query(
      `INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, pay_by, paid_at, payment_ref, commission_rate, finished_at, confirm_by)
       VALUES ($1, $2, $3, 'direct', $4, $5, 60, $5::timestamptz - interval '2 days', $5::timestamptz - interval '2 days', 'pi_ab', 0.12, $6::timestamptz, $6::timestamptz + interval '7 days') RETURNING id`,
      [U.cust, p, service, o.finishedAt ? 'finished' : 'confirmed', startAt, o.finishedAt ?? null],
    )
  ).rows[0].id as string
  await pool.query("INSERT INTO ledger_entries (booking_id, provider_id, kind, amount, gateway_ref, idempotency_key) VALUES ($1, $2, 'charge', 100, 'pi_ab', $3)", [id, p, `charge:${id}`])
  return { id, startAt }
}

/** A paid additional task of `parent` (through a request and quote, as Task 6 makes them), confirmed with its charge. */
async function paidChild(parent: string, startAt: Date, amount: number): Promise<string> {
  const req = (await pool.query("INSERT INTO requests (customer_id, provider_id, service_id, description, answer_by, parent_booking_id) VALUES ($1, $2, $3, 'Noch ein Tor', now() + interval '3 days', $4) RETURNING id", [U.cust, providerId, serviceId, parent])).rows[0].id
  const quote = (await pool.query("INSERT INTO quotes (request_id, provider_id, amount, scope, expires_at, status) VALUES ($1, $2, $3, 'Tor', now() + interval '7 days', 'accepted') RETURNING id", [req, providerId, amount])).rows[0].id
  const id = (
    await pool.query(
      `INSERT INTO bookings (customer_id, provider_id, quote_id, source, status, start_at, duration_min, parent_booking_id, pay_by, accepted_at, paid_at, payment_ref, commission_rate)
       VALUES ($1, $2, $3, 'quote', 'confirmed', $4, 60, $5, now() + interval '2 days', now(), now() - interval '1 hour', 'pi_ab_child', 0.12) RETURNING id`,
      [U.cust, providerId, quote, startAt, parent],
    )
  ).rows[0].id as string
  await pool.query("INSERT INTO ledger_entries (booking_id, provider_id, kind, amount, idempotency_key) VALUES ($1, $2, 'charge', $3, $4)", [id, providerId, amount, `charge:${id}`])
  return id
}

/** A finished booking the customer disputed: the dispute id and the booking id. */
async function disputed(o: { provider?: string } = {}): Promise<{ id: string; disputeId: string }> {
  const T = new Date(Date.now() - HOUR)
  const { id } = await paidBooking({ finishedAt: T, provider: o.provider })
  const d = await asUser(U.cust, (tx) => openDispute(tx, U.cust, id, { description: 'Die Fliesen sind schief verlegt.' }, new Date()))
  return { id, disputeId: d.id }
}

const row = async (id: string) => (await pool.query('SELECT status, completed_at, cancelled_at, no_show, no_show_reported_at, released_at FROM bookings WHERE id = $1', [id])).rows[0]
const ledger = async (id: string) => (await pool.query("SELECT kind, amount FROM ledger_entries WHERE booking_id = $1 AND kind <> 'charge' ORDER BY kind", [id])).rows
const disputeRow = async (id: string) => (await pool.query('SELECT decision, provider_share, decision_reason, decided_by, decided_at FROM disputes WHERE id = $1', [id])).rows[0]
const notes = async (id: string, kind: string) => (await pool.query('SELECT user_id FROM notifications WHERE kind = $1 AND payload->>$3 = $2 ORDER BY user_id', [kind, id, 'bookingId'])).rows.map((r) => r.user_id)
const reliability = async () => (await pool.query('SELECT provider_reliability($1) AS n', [providerId])).rows[0].n as number
const decide = (as: string, disputeId: string, body: unknown) => adminCall(decideRoute.POST, as, 'POST', '/x', body, { id: disputeId })
const refund = (as: string, bookingId: string, body: unknown) => adminCall(refundRoute.POST, as, 'POST', '/x', body, { id: bookingId })
const hide = (as: string, reviewId: string, body: unknown) => adminCall(hideRoute.POST, as, 'POST', '/x', body, { id: reviewId })
const getList = (as: string, resource: string, filter?: object) => adminCall(list.GET, as, 'GET', `/x${filter ? `?filter=${encodeURIComponent(JSON.stringify(filter))}` : ''}`, undefined, { resource })
const getOne = (as: string, resource: string, id: string) => adminCall(item.GET, as, 'GET', '/x', undefined, { resource, id })
const report = (userId: string, id: string, now: Date) => asUser(userId, (tx) => reportNoShow(tx, userId, id, now))
const object = (userId: string, id: string, now: Date) => asUser(userId, (tx) => objectNoShow(tx, userId, id, { description: 'Ich war um 10 Uhr da und habe geklingelt.' }, now))
const disputeOf = async (bookingId: string) => (await pool.query('SELECT id FROM disputes WHERE booking_id = $1', [bookingId])).rows[0].id as string

it('an administrator decides partial 30 of 100: refund 70, commission on 30, both told with the reason', async () => {
  const { id, disputeId } = await disputed()
  const res = await decide(U.admin, disputeId, { decision: 'partial', providerShare: 30, reason: REASON })
  expect(res.status).toBe(200)
  const body = (await res.json()).data
  expect(body).toMatchObject({ id: disputeId, decision: 'partial', providerShare: 30, decisionReason: REASON, bookingStatus: 'completed', applied: true })
  expect(await ledger(id)).toEqual([
    { kind: 'commission', amount: '3.60' },
    { kind: 'refund', amount: '70.00' },
    { kind: 'transfer', amount: '26.40' },
  ])
  expect(await disputeRow(disputeId)).toMatchObject({ decision: 'partial', provider_share: '30.00', decision_reason: REASON, decided_by: U.admin })
  const r = await row(id)
  expect(r.status).toBe('completed')
  expect(r.completed_at).not.toBeNull()
  expect(r.released_at).not.toBeNull()
  // both told, with the written reason; a completed root asks both for a review
  expect(await notes(id, 'dispute-decided')).toEqual([U.cust, U.owner].sort())
  expect(await notes(id, 'review-requested')).toEqual([U.cust, U.owner].sort())
  const mails = outboxForTests().filter((m) => m.text.includes(REASON))
  expect(mails.map((m) => m.to).sort()).toEqual([EMAIL(U.cust), EMAIL(U.owner)].sort())
  for (const m of mails) expect(m.text.toLowerCase()).not.toMatch(/treuhand|escrow|garantie/)
})

it('a partial larger than paid, negative, or with an empty reason is 400', async () => {
  const { id, disputeId } = await disputed()
  for (const body of [
    { decision: 'partial', providerShare: 100.01, reason: REASON }, // above what was paid
    { decision: 'partial', providerShare: 100, reason: REASON }, // the whole amount is a full payout, not a partial
    { decision: 'partial', providerShare: -1, reason: REASON },
    { decision: 'partial', providerShare: 0, reason: REASON }, // nothing is a full refund
    { decision: 'partial', providerShare: 30.001, reason: REASON },
    { decision: 'partial', reason: REASON }, // the share is required
    { decision: 'partial', providerShare: 30, reason: '' },
    { decision: 'partial', providerShare: 30, reason: '   kurz   ' }, // under 10 characters
    { decision: 'full-payout', providerShare: 30, reason: REASON }, // a share only with partial
    { decision: 'maybe', reason: REASON },
  ]) {
    expect((await decide(U.admin, disputeId, body)).status, JSON.stringify(body)).toBe(400)
  }
  expect((await disputeRow(disputeId)).decided_at).toBeNull()
  expect((await row(id)).status).toBe('disputed')
  expect(await ledger(id)).toEqual([])
  // an unknown dispute is 404
  expect((await decide(U.admin, '00000000-0000-0000-0000-000000000009', { decision: 'full-refund', reason: REASON })).status).toBe(404)
})

it('a reviewer can read but not decide (403)', async () => {
  const { id, disputeId } = await disputed()
  for (const resource of ['bookings', 'disputes', 'refunds', 'reviews']) expect((await getList(U.rev, resource)).status, resource).toBe(200)
  expect((await getOne(U.rev, 'bookings', id)).status).toBe(200)
  expect((await getOne(U.rev, 'disputes', disputeId)).status).toBe(200)
  expect((await decide(U.rev, disputeId, { decision: 'full-refund', reason: REASON })).status).toBe(403)
  expect((await refund(U.rev, id, { providerShare: 0, reason: REASON })).status).toBe(403)
  expect((await hide(U.rev, '00000000-0000-0000-0000-000000000009', { hidden: true, reason: REASON })).status).toBe(403)
  // a party without a staff role and a signed-out caller get nothing
  expect((await getList(U.cust, 'bookings')).status).toBe(403)
  expect((await decide(U.cust, disputeId, { decision: 'full-refund', reason: REASON })).status).toBe(403)
  expect((await decide('', disputeId, { decision: 'full-refund', reason: REASON })).status).toBe(401)
  expect((await disputeRow(disputeId)).decided_at).toBeNull()
})

it('deciding twice is 409', async () => {
  const { id, disputeId } = await disputed()
  expect((await decide(U.admin, disputeId, { decision: 'full-refund', reason: REASON })).status).toBe(200)
  const again = await decide(U.admin, disputeId, { decision: 'full-payout', reason: REASON })
  expect([again.status, await again.json()]).toEqual([409, { error: 'ALREADY_DECIDED' }])
  expect(await ledger(id)).toEqual([{ kind: 'refund', amount: '100.00' }])
  expect((await row(id)).status).toBe('refunded')
  // refunded: never reviewable, nobody asked for a review
  expect(await notes(id, 'review-requested')).toEqual([])
})

it('two administrators deciding at once: exactly one outcome', async () => {
  const { id, disputeId } = await disputed()
  await seedUser('ab-admin2', 'admin')
  // hold the booking row: both decisions must wait for it (proves they lock it), then exactly one wins
  const holder = await pool.connect()
  let both: Promise<Response[]>
  try {
    await holder.query('BEGIN')
    await holder.query('SELECT id FROM bookings WHERE id = $1 FOR UPDATE', [id])
    both = Promise.all([decide(U.admin, disputeId, { decision: 'full-refund', reason: REASON }), decide('ab-admin2', disputeId, { decision: 'full-payout', reason: REASON })])
    await new Promise((ok) => setTimeout(ok, 500))
    expect((await disputeRow(disputeId)).decided_at).toBeNull()
    await holder.query('COMMIT')
  } finally {
    holder.release()
  }
  const res = await both
  expect(res.map((r) => r.status).sort()).toEqual([200, 409])
  const winner = (await disputeRow(disputeId)).decision as string
  expect(await ledger(id)).toEqual(winner === 'full-refund' ? [{ kind: 'refund', amount: '100.00' }] : [{ kind: 'commission', amount: '12.00' }, { kind: 'transfer', amount: '88.00' }])
  expect(await notes(id, 'dispute-decided')).toEqual([U.cust, U.owner].sort())
})

it('a settle failure keeps the decision; the timer settles it later and staff see the flag', async () => {
  const { id, disputeId } = await disputed({ provider: bareProviderId }) // no payout account
  const res = await decide(U.admin, disputeId, { decision: 'full-payout', reason: REASON })
  expect(res.status).toBe(200)
  expect((await res.json()).data).toMatchObject({ decision: 'full-payout', providerShare: 100, bookingStatus: 'disputed', applied: false })
  expect((await disputeRow(disputeId)).decided_at).not.toBeNull()
  expect(await row(id)).toMatchObject({ status: 'disputed', released_at: null })
  expect(await ledger(id)).toEqual([])
  const flag = async () => (await pool.query("SELECT resolved_at FROM staff_flags WHERE kind = 'payment-unprocessed' AND ref_id = $1", [id])).rows
  expect(await flag()).toEqual([{ resolved_at: null }])
  expect(await notes(id, 'dispute-decided')).toEqual([])
  // still failing: the timer leaves it as it is
  await runDueTimers(db, new Date())
  expect((await row(id)).status).toBe('disputed')
  // fixed: the next run pays it out, with the decided share, and closes the flag
  await pool.query("UPDATE providers SET stripe_account_id = 'acct_ab_2' WHERE id = $1", [bareProviderId])
  const report = await runDueTimers(db, new Date())
  expect(report.decisionsApplied).toBe(1)
  expect(await row(id)).toMatchObject({ status: 'completed' })
  expect(await ledger(id)).toEqual([{ kind: 'commission', amount: '12.00' }, { kind: 'transfer', amount: '88.00' }])
  expect((await flag())[0].resolved_at).not.toBeNull()
  expect(await notes(id, 'dispute-decided')).toEqual([U.bare, U.cust].sort())
  // a second run does nothing more
  expect((await runDueTimers(db, new Date())).decisionsApplied).toBe(0)
  expect(await notes(id, 'dispute-decided')).toHaveLength(2)
  await pool.query('UPDATE providers SET stripe_account_id = NULL WHERE id = $1', [bareProviderId])
})

it('an open chargeback flag must be resolved before a decision; then it settles', async () => {
  const { id, disputeId } = await disputed()
  await pool.query("INSERT INTO staff_flags (kind, ref_id, user_id, note) VALUES ('chargeback', $1, $2, 'test')", [id, U.cust])
  const res = await decide(U.admin, disputeId, { decision: 'full-refund', reason: REASON })
  expect([res.status, await res.json()]).toEqual([409, { error: 'CHARGEBACK_OPEN' }])
  expect((await disputeRow(disputeId)).decided_at).toBeNull()
  // a staff refund is frozen the same way
  expect((await refund(U.admin, id, { providerShare: 0, reason: REASON })).status).toBe(409)
  expect(await ledger(id)).toEqual([])
  await pool.query("UPDATE staff_flags SET resolved_at = now(), resolved_by = $2 WHERE kind = 'chargeback' AND ref_id = $1", [id, U.admin])
  expect((await decide(U.admin, disputeId, { decision: 'full-refund', reason: REASON })).status).toBe(200)
  expect(await ledger(id)).toEqual([{ kind: 'refund', amount: '100.00' }])
})

it('an upheld provider no-show refunds, counts, warns the first time and flags staff the second', async () => {
  const flags = async () => (await pool.query("SELECT ref_id FROM staff_flags WHERE kind = 'provider-no-shows' AND resolved_at IS NULL AND ref_id = $1", [providerId])).rows
  const warnings = async () => (await pool.query("SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND kind = 'provider-warning'", [U.owner])).rows[0].n
  const before = await reliability()
  const upheld = async () => {
    const { id } = await paidBooking()
    await report(U.cust, id, new Date())
    await object(U.owner, id, new Date())
    expect((await decide(U.admin, await disputeOf(id), { decision: 'full-refund', reason: 'Der Anbieter war nachweislich nicht da.' })).status).toBe(200)
    return id
  }
  const first = await upheld()
  expect(await row(first)).toMatchObject({ status: 'cancelled', no_show: 'provider' })
  expect(await ledger(first)).toEqual([{ kind: 'refund', amount: '100.00' }])
  expect(await reliability()).toBe(before + 1)
  expect(await warnings()).toBe(1)
  expect(await flags()).toEqual([])
  expect(await notes(first, 'review-requested')).toEqual([])
  await upheld()
  expect(await flags()).toEqual([{ ref_id: providerId }])
  expect(await warnings()).toBe(1)
  expect(await reliability()).toBe(before + 2)
})

it('an overturned no-show is cleared: no count, the booking ends by the decided share', async () => {
  const before = await reliability()
  const { id } = await paidBooking()
  await report(U.cust, id, new Date())
  await object(U.owner, id, new Date())
  expect((await decide(U.admin, await disputeOf(id), { decision: 'full-payout', reason: 'Der Anbieter war da, siehe Chat.' })).status).toBe(200)
  expect(await row(id)).toMatchObject({ status: 'completed', no_show: null, no_show_reported_at: null })
  expect(await reliability()).toBe(before)
  expect(await notes(id, 'provider-warning')).toEqual([])
})

it("a decision on an objected root no-show ends its frozen additional tasks the same way", async () => {
  // upheld: the root and its paid additional task are refunded in full
  const root = await paidBooking()
  const kid = await paidChild(root.id, root.startAt, 40)
  await report(U.cust, root.id, new Date())
  await object(U.owner, root.id, new Date())
  expect(await row(kid)).toMatchObject({ status: 'confirmed', no_show: 'provider' })
  expect((await decide(U.admin, await disputeOf(root.id), { decision: 'full-refund', reason: 'Der Anbieter war nachweislich nicht da.' })).status).toBe(200)
  expect(await row(root.id)).toMatchObject({ status: 'cancelled', no_show: 'provider' })
  expect(await row(kid)).toMatchObject({ status: 'cancelled', no_show: 'provider' })
  expect((await row(kid)).released_at).not.toBeNull()
  expect(await ledger(kid)).toEqual([{ kind: 'refund', amount: '40.00' }])

  // overturned: the additional task's no-show is cleared too, and it goes on on its own clock
  const root2 = await paidBooking()
  const kid2 = await paidChild(root2.id, root2.startAt, 40)
  await report(U.cust, root2.id, new Date())
  await object(U.owner, root2.id, new Date())
  expect((await decide(U.admin, await disputeOf(root2.id), { decision: 'partial', providerShare: 50, reason: 'Der Anbieter war da, aber spät.' })).status).toBe(200)
  expect(await row(root2.id)).toMatchObject({ status: 'completed', no_show: null })
  expect(await row(kid2)).toMatchObject({ status: 'confirmed', no_show: null, no_show_reported_at: null, released_at: null })
  expect(await ledger(kid2)).toEqual([])
})

it('a staff refund settles an unsettled paid booking once, and is listed', async () => {
  const { id } = await paidBooking({ finishedAt: new Date(Date.now() - HOUR) })
  for (const body of [{ providerShare: 100.01, reason: REASON }, { providerShare: -1, reason: REASON }, { providerShare: 20, reason: '' }]) {
    expect((await refund(U.admin, id, body)).status, JSON.stringify(body)).toBe(400)
  }
  const res = await refund(U.admin, id, { providerShare: 20, reason: REASON })
  expect(res.status).toBe(200)
  expect((await res.json()).data).toMatchObject({ id, status: 'completed' })
  expect(await ledger(id)).toEqual([
    { kind: 'commission', amount: '2.40' },
    { kind: 'refund', amount: '80.00' },
    { kind: 'transfer', amount: '17.60' },
  ])
  expect((await row(id)).completed_at).not.toBeNull()
  expect(await notes(id, 'refund-issued')).toEqual([U.cust, U.owner].sort())
  expect(outboxForTests().filter((m) => m.text.includes(REASON)).map((m) => m.to).sort()).toEqual([EMAIL(U.cust), EMAIL(U.owner)].sort())
  // a second refund: already settled
  const again = await refund(U.admin, id, { providerShare: 0, reason: REASON })
  expect([again.status, await again.json()]).toEqual([409, { error: 'ALREADY_SETTLED' }])
  // a disputed booking is decided through its dispute
  const d = await disputed()
  expect(await (await refund(U.admin, d.id, { providerShare: 0, reason: REASON })).json()).toEqual({ error: 'DISPUTE_OPEN' })
  // a full refund of a confirmed booking: refunded, never reviewable
  const c = await paidBooking()
  expect((await refund(U.admin, c.id, { providerShare: 0, reason: REASON })).status).toBe(200)
  expect(await row(c.id)).toMatchObject({ status: 'refunded' })
  expect(await notes(c.id, 'review-requested')).toEqual([])
  // the refunds list shows the ledger refund rows, without gateway references
  const listed = (await (await getList(U.rev, 'refunds')).json()).data as Record<string, unknown>[]
  expect(listed.find((r) => r.bookingId === id)).toMatchObject({ bookingId: id, amount: 80, currency: 'EUR', customerEmail: EMAIL(U.cust) })
  expect(JSON.stringify(listed)).not.toMatch(/gatewayRef|pi_ab|re_/)
})

it('hiding a review removes it from the provider page', async () => {
  const { id } = await paidBooking()
  await pool.query("UPDATE bookings SET status = 'completed', completed_at = now() - interval '8 days', released_at = now() - interval '8 days' WHERE id = $1", [id])
  const reviewId = (
    await pool.query(
      "INSERT INTO reviews (booking_id, author_id, subject_id, author_role, stars, text, visible_at) VALUES ($1, $2, $3, 'customer', 1, 'Beleidigender Text', now() - interval '1 day') RETURNING id",
      [id, U.cust, U.owner],
    )
  ).rows[0].id as string
  const page = () => asUser(null, (tx) => getPublicProfile(tx, slug, 'de'))
  const shownBefore = (await page())!.rating
  expect(shownBefore?.count).toBeGreaterThanOrEqual(1)
  expect((await hide(U.admin, reviewId, { hidden: true, reason: '' })).status).toBe(400)
  const res = await hide(U.admin, reviewId, { hidden: true, reason: 'Beleidigung, verstößt gegen die Regeln.' })
  expect(res.status).toBe(200)
  expect((await res.json()).data).toMatchObject({ id: reviewId, hidden: true, hiddenReason: 'Beleidigung, verstößt gegen die Regeln.' })
  const after = await page()
  expect(after!.rating?.count ?? 0).toBe((shownBefore?.count ?? 0) - 1)
  expect((after!.reviews ?? []).some((r: { text: string | null }) => r.text === 'Beleidigender Text')).toBe(false)
  // the reveal time is untouched (the blind rule stays), and it can be shown again with a reason
  const vis = (await pool.query('SELECT visible_at FROM reviews WHERE id = $1', [reviewId])).rows[0].visible_at
  expect(vis).not.toBeNull()
  expect((await hide(U.admin, reviewId, { hidden: false, reason: 'Nach Prüfung doch zulässig.' })).status).toBe(200)
  expect((await page())!.rating).toEqual(shownBefore)
  expect((await pool.query('SELECT visible_at, hidden, hidden_reason FROM reviews WHERE id = $1', [reviewId])).rows[0]).toEqual({ visible_at: vis, hidden: false, hidden_reason: null })
  // the reviews list shows it to staff; an unknown review is 404
  expect(((await (await getList(U.rev, 'reviews')).json()).data as { id: string }[]).some((r) => r.id === reviewId)).toBe(true)
  expect((await hide(U.admin, '00000000-0000-0000-0000-000000000009', { hidden: true, reason: REASON })).status).toBe(404)
})

it('bookings and disputes lists put overdue disputes first; details carry no secrets; reading a dispute is logged', async () => {
  const { id, disputeId } = await disputed()
  const threadId = await threadForBooking(db, id)
  await pool.query("UPDATE disputes SET decide_by = now() - interval '1 day' WHERE id = $1", [disputeId])
  const bookings = (await (await getList(U.rev, 'bookings')).json()).data as { id: string; disputeOverdue: boolean }[]
  expect(bookings[0]).toMatchObject({ id, disputeOverdue: true })
  expect(((await (await getList(U.rev, 'bookings', { status: 'disputed' })).json()).data as { status: string }[]).every((b) => b.status === 'disputed')).toBe(true)
  const disputesList = (await (await getList(U.rev, 'disputes')).json()).data as { id: string }[]
  expect(disputesList[0]!.id).toBe(disputeId)

  const detail = (await (await getOne(U.rev, 'bookings', id)).json()).data
  expect(detail).toMatchObject({ id, status: 'disputed', amount: 100, paid: 100, customerEmail: EMAIL(U.cust), providerName: 'Ab Owner', dispute: { id: disputeId } })
  expect(detail.ledger).toEqual([expect.objectContaining({ kind: 'charge', amount: 100 })])
  expect(detail).toHaveProperty('children')
  const text = JSON.stringify(detail)
  for (const secret of ['paymentRef', 'checkoutRef', 'gatewayRef', 'stripeAccountId', 'pi_ab', 'acct_ab', 'commissionRate']) expect(text).not.toContain(secret)

  const before = (await pool.query('SELECT count(*)::int n FROM staff_access_log WHERE staff_id = $1 AND flag_id = $2', [U.rev, disputeId])).rows[0].n
  const one = (await (await getOne(U.rev, 'disputes', disputeId)).json()).data
  expect(one).toMatchObject({ id: disputeId, bookingId: id, reason: 'problem', description: 'Die Fliesen sind schief verlegt.', paid: 100 })
  expect((await pool.query('SELECT count(*)::int n FROM staff_access_log WHERE staff_id = $1 AND flag_id = $2', [U.rev, disputeId])).rows[0].n).toBe(before + 1)
  // the chat of the disputed booking is readable through the logged thread route
  expect(one.threadId).toBe(threadId)
  expect((await adminCall(threadRoute.GET, U.rev, 'GET', '/x', undefined, { id: threadId })).status).toBe(200)
})

it('the domain call checks the share against the paid amount itself', async () => {
  const { disputeId } = await disputed()
  const refusal = await decideDispute(db, U.admin, disputeId, { decision: 'partial', providerShare: 150, reason: REASON }, new Date()).then(
    () => 0,
    (e: unknown) => (e instanceof Response ? e.status : -1),
  )
  expect(refusal).toBe(400)
  expect((await disputeRow(disputeId)).decided_at).toBeNull()
})
