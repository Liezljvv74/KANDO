import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { asUser, db, pool } from '@kando/db'
import { sql } from 'drizzle-orm'
import { clearOutbox, clearPushOutbox, editReview, exportMyData, getPublicProfile, getRequest, listMyReviews, listRequests, providerRating, runDueTimers, writeReview } from '@kando/domain'
import { outboxForTests, pushOutboxForTests, setGatewayForTests } from '@kando/domain/src/testing'
import { call, cleanupUsers, EMAIL, seedBase, seedProvider, seedUser } from './helpers'
import { fakeGateway } from './fake-gateway'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const reviewsRoute = await import('../app/app-api/v1/reviews/route')
const reviewRoute = await import('../app/app-api/v1/reviews/[id]/route')

const U = { cust: 'rv-cust', other: 'rv-other', owner: 'rv-owner', rated: 'rv-rated', third: 'rv-third' }
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
let providerId: string, ratedProviderId: string
let slot = 0

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  await seedUser(U.cust)
  await seedUser(U.third)
  await seedUser(U.other)
  providerId = await seedProvider(U.owner, { name: 'Rv Owner', categoryId, price: 100 })
  ratedProviderId = await seedProvider(U.rated, { name: 'Rv Rated', categoryId, price: 100 })
})
beforeEach(async () => {
  vi.stubEnv('PAYMENTS_ENABLED', 'true')
  setGatewayForTests(fakeGateway())
  await pool.query("DELETE FROM notifications WHERE user_id LIKE 'rv-%'")
})
afterEach(() => {
  setGatewayForTests(undefined)
  vi.unstubAllEnvs()
})
afterAll(cleanupUsers)

/** A root booking of rv-cust (or `customer`), completed at `completedAt` (default an hour ago), as releaseBooking leaves it. */
async function done(o: { completedAt?: Date; status?: string; provider?: string; parent?: string; customer?: string } = {}): Promise<{ id: string; completedAt: Date }> {
  const completedAt = o.completedAt ?? new Date(Date.now() - HOUR)
  const status = o.status ?? 'completed'
  const p = o.provider ?? providerId
  const startAt = new Date(completedAt.getTime() - DAY - ++slot * 3 * HOUR)
  const service = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [p])).rows[0].id
  const id = (
    await pool.query(
      `INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, pay_by, paid_at, payment_ref, commission_rate, finished_at, completed_at, released_at, parent_booking_id)
       VALUES ($1, $2, $3, 'direct', $4, $5, 60, $5::timestamptz - interval '2 days', $5::timestamptz - interval '2 days', 'pi_rv_' || gen_random_uuid(), 0.12, $5::timestamptz + interval '1 hour',
         CASE WHEN $4 = 'completed' THEN $6::timestamptz END, CASE WHEN $4 = 'completed' THEN $6::timestamptz END, $7) RETURNING id`,
      [o.customer ?? U.cust, p, service, status, startAt, completedAt, o.parent ?? null],
    )
  ).rows[0].id as string
  return { id, completedAt }
}

const refusal = (p: Promise<unknown>) =>
  p.then(
    () => ({ status: 0, body: null }),
    async (e: unknown) => (e instanceof Response ? { status: e.status, body: await e.json() } : Promise.reject(e)),
  )
const write = (uid: string, bookingId: string, now: Date, input: { stars: number; text?: string } = { stars: 5, text: 'Sehr gut' }) => asUser(uid, (tx) => writeReview(tx, uid, bookingId, input, now))
const mine = (uid: string, now = new Date()) => asUser(uid, (tx) => listMyReviews(tx, uid, now))
const post = (uid: string, body: unknown) => call(reviewsRoute.POST, uid, 'POST', body)
const rows = async (bookingId: string) => (await pool.query('SELECT author_id, subject_id, author_role, stars, text, visible_at, created_at FROM reviews WHERE booking_id = $1 ORDER BY author_role', [bookingId])).rows
/** review-visible emails and pushes per person (each side has one device in these tests). */
const told = () => ({
  mails: outboxForTests().filter((m) => [EMAIL(U.cust), EMAIL(U.owner)].includes(m.to) && /Bewertung|review/i.test(m.subject)).map((m) => m.to).sort(),
  pushes: pushOutboxForTests().filter((m) => m.data.kind === 'review-visible').map((m) => m.to).sort(),
})
const withDevices = async () => {
  await pool.query("DELETE FROM push_tokens WHERE user_id LIKE 'rv-%'")
  for (const u of [U.cust, U.owner]) await pool.query("INSERT INTO push_tokens (user_id, token, platform) VALUES ($1, $2, 'ios')", [u, `ExponentPushToken[${u}]`])
  clearOutbox()
  clearPushOutbox()
}
const BOTH = { mails: [EMAIL(U.cust), EMAIL(U.owner)].sort(), pushes: ['ExponentPushToken[rv-cust]', 'ExponentPushToken[rv-owner]'] }
const visibleNotes = async (bookingId: string) => (await pool.query("SELECT user_id FROM notifications WHERE kind = 'review-visible' AND payload->>'bookingId' = $1 ORDER BY user_id", [bookingId])).rows.map((r) => r.user_id)
const publicPage = (slug: string) => asUser(null, (tx) => getPublicProfile(tx, slug, 'de'))
/** What a party can read straight from the table under row-level security (no domain filter). */
const rlsRows = (uid: string | null, bookingId: string) => asUser(uid, async (tx) => (await tx.execute(sql`SELECT author_id FROM reviews WHERE booking_id = ${bookingId}`)).rows)

it("neither side sees the other's review until both are in", async () => {
  const { id } = await done()
  const res = await post(U.cust, { bookingId: id, stars: 4, text: 'Pünktlich und sauber' })
  expect(res.status).toBe(201)
  const own = await res.json()
  expect(own).toMatchObject({ bookingId: id, mine: true, authorRole: 'customer', stars: 4, text: 'Pünktlich und sauber' })
  expect(Object.keys(own).sort()).toEqual(['authorRole', 'bookingId', 'createdAt', 'editableUntil', 'hidden', 'id', 'mine', 'stars', 'text', 'visibleAt'])
  expect(new Date(own.visibleAt).getTime()).toBeGreaterThan(Date.now()) // 7 days after completion
  // the author sees it, the provider does not (neither through the route nor the table), nor does anyone else
  expect((await (await call(reviewsRoute.GET, U.cust)).json()).docs.map((r: { bookingId: string }) => r.bookingId)).toContain(id)
  expect((await (await call(reviewsRoute.GET, U.owner)).json()).docs.filter((r: { bookingId: string }) => r.bookingId === id)).toEqual([])
  expect(await rlsRows(U.owner, id)).toEqual([])
  expect(await rlsRows(null, id)).toEqual([])
  expect(await rlsRows(U.third, id)).toEqual([])
  expect((await publicPage(`${U.owner}-slug`))?.reviews ?? []).toEqual([])
  expect(await visibleNotes(id)).toEqual([])
})

it('both appear together when the second is written', async () => {
  const { id } = await done()
  await withDevices()
  await write(U.cust, id, new Date(), { stars: 5, text: 'Top' })
  expect(told()).toEqual({ mails: [], pushes: [] })
  const now = new Date()
  const second = await write(U.owner, id, now, { stars: 4 })
  expect(second).toMatchObject({ authorRole: 'provider', stars: 4, text: null, visibleAt: now.toISOString() })
  const r = await rows(id)
  expect(r.map((x) => [x.author_role, x.author_id, x.subject_id])).toEqual([
    ['customer', U.cust, U.owner],
    ['provider', U.owner, U.cust],
  ])
  expect(r.map((x) => x.visible_at.getTime())).toEqual([now.getTime(), now.getTime()])
  // each side now reads both; a third person reads them as public reviews (the table policy), never anything else
  for (const u of [U.cust, U.owner]) {
    const docs = (await mine(u)).filter((x) => x.bookingId === id)
    expect(docs.map((x) => [x.authorRole, x.mine]).sort()).toEqual([
      ['customer', u === U.cust],
      ['provider', u === U.owner],
    ])
  }
  expect((await mine(U.owner)).find((x) => x.bookingId === id && !x.mine)?.editableUntil).toBeNull() // only the author's own edit date
  expect(await visibleNotes(id)).toEqual([U.cust, U.owner].sort())
  // a later timer run tells nobody again
  expect((await pool.query('SELECT reveal_told_at FROM reviews WHERE booking_id = $1', [id])).rows[0].reveal_told_at).not.toBeNull()
  await runDueTimers(db, new Date())
  expect(await visibleNotes(id)).toEqual([U.cust, U.owner].sort())
  expect(told()).toEqual(BOTH) // one email and one push per side, none again from the timer
})

it('one review alone appears after 7 days', async () => {
  // completed 7 days and a minute ago: the customer wrote on day 1, the provider never did
  const { id, completedAt } = await done({ completedAt: new Date(Date.now() - 7 * DAY - MIN) })
  await withDevices()
  const own = await write(U.cust, id, new Date(completedAt.getTime() + DAY), { stars: 3 })
  const at = completedAt.getTime() + 7 * DAY
  expect(new Date(own.visibleAt!).getTime()).toBe(at)
  // the other side's view, with the clock just before and at the reveal
  expect((await mine(U.owner, new Date(at - 1))).filter((x) => x.bookingId === id)).toEqual([])
  expect((await mine(U.owner, new Date(at))).filter((x) => x.bookingId === id)).toMatchObject([{ authorRole: 'customer', stars: 3, mine: false }])
  // the window to write closes at the reveal (one millisecond before it is still open: next test)
  expect(await refusal(write(U.owner, id, new Date(at)))).toEqual({ status: 409, body: { error: 'REVIEW_CLOSED' } })
  // the reveal is told once to both (the timer), and a second run sends nothing more
  expect(await visibleNotes(id)).toEqual([])
  expect((await pool.query('SELECT reveal_told_at FROM reviews WHERE booking_id = $1', [id])).rows[0].reveal_told_at).toBeNull()
  const first = await runDueTimers(db, new Date())
  expect(first.reviewsShown).toBeGreaterThanOrEqual(1)
  expect(await visibleNotes(id)).toEqual([U.cust, U.owner].sort())
  expect((await pool.query('SELECT reveal_told_at FROM reviews WHERE booking_id = $1', [id])).rows[0].reveal_told_at).not.toBeNull()
  await runDueTimers(db, new Date())
  expect(await visibleNotes(id)).toEqual([U.cust, U.owner].sort())
  expect(told()).toEqual(BOTH) // the timer's reveal: one email and one push per side, once
})

it('a review written one millisecond before the 7 days end still reveals both at once', async () => {
  const { id, completedAt } = await done({ completedAt: new Date(Date.now() - 7 * DAY + HOUR) })
  await write(U.cust, id, new Date(completedAt.getTime() + HOUR))
  const now = new Date(completedAt.getTime() + 7 * DAY - 1)
  await write(U.owner, id, now, { stars: 2 })
  expect((await rows(id)).map((x) => x.visible_at.getTime())).toEqual([now.getTime(), now.getTime()])
})

it('editing works until the review is shown, then it is final (blind: nobody edits after reading the other side)', async () => {
  const { id, completedAt } = await done()
  const created = new Date(completedAt.getTime() + MIN)
  const r = await write(U.cust, id, created, { stars: 2, text: 'Naja' })
  const reveal = completedAt.getTime() + 7 * DAY
  expect(r.editableUntil).toBe(new Date(reveal).toISOString()) // the reveal comes before the 14 days
  const edit = (uid: string, now: Date, input = { stars: 3, text: 'Doch ganz gut' }) => asUser(uid, (tx) => editReview(tx, uid, r.id, input, now))
  // before the reveal: allowed, up to its last millisecond
  expect(await edit(U.cust, new Date(created.getTime() + DAY))).toMatchObject({ stars: 3, text: 'Doch ganz gut', visibleAt: r.visibleAt })
  expect(await edit(U.cust, new Date(reveal - 1), { stars: 4, text: 'Gut' })).toMatchObject({ stars: 4 })
  // shown by the 7 days, and after 14 days: final
  const final = { status: 409, body: { error: 'REVIEW_FINAL' } }
  expect(await refusal(edit(U.cust, new Date(reveal)))).toEqual(final)
  expect(await refusal(edit(U.cust, new Date(created.getTime() + 14 * DAY)))).toEqual(final)
  expect(await refusal(edit(U.cust, new Date(created.getTime() + 15 * DAY)))).toEqual(final)
  // only its author: the other side and a third person get 404 (through the route as well)
  expect(await refusal(edit(U.owner, created))).toEqual({ status: 404, body: { error: 'Not found' } })
  expect((await call(reviewRoute.PATCH, U.third, 'PATCH', { stars: 1 }, { id: r.id })).status).toBe(404)
  expect((await call(reviewRoute.PATCH, U.cust, 'PATCH', { stars: 6 }, { id: r.id })).status).toBe(400)
  expect((await rows(id))[0]).toMatchObject({ stars: 4, text: 'Gut' })
})

it('once both reviews are in, neither can be edited', async () => {
  const { id } = await done()
  const first = await write(U.cust, id, new Date(), { stars: 1, text: 'Schlecht' })
  // the first author may still edit while alone
  expect(await asUser(U.cust, (tx) => editReview(tx, U.cust, first.id, { stars: 2, text: 'Mäßig' }, new Date()))).toMatchObject({ stars: 2 })
  const second = await write(U.owner, id, new Date(), { stars: 5 })
  expect(second.editableUntil).toBe(second.visibleAt) // final the moment it is written: both are shown
  const final = { status: 409, body: { error: 'REVIEW_FINAL' } }
  expect(await refusal(asUser(U.owner, (tx) => editReview(tx, U.owner, second.id, { stars: 1, text: 'Retourkutsche' }, new Date())))).toEqual(final)
  expect(await refusal(asUser(U.cust, (tx) => editReview(tx, U.cust, first.id, { stars: 1 }, new Date())))).toEqual(final)
  // even with a clock read a moment before the reveal: both in is final
  expect(await refusal(asUser(U.cust, (tx) => editReview(tx, U.cust, first.id, { stars: 1 }, new Date(Date.now() - 60_000))))).toEqual(final)
  expect((await rows(id)).map((x) => x.stars)).toEqual([2, 5])
})

it('a review with a phone number is 422', async () => {
  const { id } = await done()
  const res = await post(U.cust, { bookingId: id, stars: 5, text: 'Ruf mich an: 0151 2345 6789' })
  expect(res.status).toBe(422)
  expect(await res.json()).toEqual({ error: 'CONTACT_DETAILS' })
  expect(await rows(id)).toEqual([])
  const r = await write(U.cust, id, new Date(), { stars: 5, text: 'Gut' })
  expect((await call(reviewRoute.PATCH, U.cust, 'PATCH', { stars: 5, text: 'Schreib mir: anna@example.com' }, { id: r.id })).status).toBe(422)
  expect((await rows(id))[0].text).toBe('Gut')
})

it('a review on a cancelled or refunded booking is 409', async () => {
  for (const status of ['cancelled', 'refunded', 'finished', 'disputed', 'stopped']) {
    const { id } = await done({ status })
    expect(await refusal(write(U.cust, id, new Date()))).toEqual({ status: 409, body: { error: 'not-open' } })
    expect(await rows(id)).toEqual([])
  }
  // an additional task is reviewed with its root only (one review per job)
  const root = await done()
  const child = await done({ parent: root.id })
  expect(await refusal(write(U.cust, child.id, new Date()))).toEqual({ status: 409, body: { error: 'not-open' } })
})

it('a third person gets 404, a second review by the same author 409, a bad body 400', async () => {
  const { id } = await done()
  expect((await post(U.third, { bookingId: id, stars: 5 })).status).toBe(404)
  expect((await post(U.cust, { bookingId: id, stars: 0 })).status).toBe(400)
  expect((await post(U.cust, { bookingId: id, stars: 4.5 })).status).toBe(400)
  expect((await post(U.cust, { bookingId: id, stars: 5, text: 'x'.repeat(2001) })).status).toBe(400)
  expect((await post(U.cust, { bookingId: 'nope', stars: 5 })).status).toBe(400)
  expect((await post(U.cust, { bookingId: id, stars: 5 })).status).toBe(201)
  expect(await refusal(write(U.cust, id, new Date()))).toEqual({ status: 409, body: { error: 'REVIEW_EXISTS' } })
  expect(await rows(id)).toHaveLength(1)
})

it('two simultaneous reviews of each side: one per author, and both show together', async () => {
  const { id } = await done()
  // hold the booking row: every write must wait for it (proves they lock it), then they run one after the other
  const holder = await pool.connect()
  let all: Promise<Response[]>
  try {
    await holder.query('BEGIN')
    await holder.query('SELECT id FROM bookings WHERE id = $1 FOR UPDATE', [id])
    all = Promise.all([post(U.cust, { bookingId: id, stars: 5 }), post(U.cust, { bookingId: id, stars: 4 }), post(U.owner, { bookingId: id, stars: 3 })])
    await new Promise((ok) => setTimeout(ok, 500))
    expect(await rows(id)).toEqual([])
    await holder.query('COMMIT')
  } finally {
    holder.release()
  }
  const res = await all
  expect(res.map((x) => x.status).sort()).toEqual([201, 201, 409])
  const r = await rows(id)
  expect(r.map((x) => x.author_role)).toEqual(['customer', 'provider'])
  expect(r[0].visible_at.getTime()).toBe(r[1].visible_at.getTime()) // the second saw the first: shown together
  expect(r[0].visible_at.getTime()).toBeLessThanOrEqual(Date.now())
  expect(await visibleNotes(id)).toEqual([U.cust, U.owner].sort())
})

/** A review between rv-other and the rated provider: shown a day ago (written on day 1, shown on day 7), or not yet. */
async function shown(stars: number, by: 'customer' | 'provider' = 'customer', visible = true) {
  const { id, completedAt } = await done({ provider: ratedProviderId, customer: U.other, completedAt: new Date(Date.now() - (visible ? 8 : 1) * DAY) })
  const uid = by === 'customer' ? U.other : U.rated
  return write(uid, id, new Date(completedAt.getTime() + HOUR), { stars, text: `${stars} Sterne` })
}

it('the provider page shows average and count of visible customer reviews only', async () => {
  const page0 = await publicPage(`${U.rated}-slug`)
  expect(page0).toMatchObject({ rating: null, reviews: [] })
  await shown(5)
  await shown(4)
  await shown(2)
  await shown(1, 'customer', false) // not yet visible
  await shown(1, 'provider') // the provider's review of the customer: about the customer, not counted here
  expect(await providerRating(db, ratedProviderId)).toEqual({ average: 3.7, count: 3 }) // 11 / 3 to one decimal
  const page = await publicPage(`${U.rated}-slug`)
  expect(page?.rating).toEqual({ average: 3.7, count: 3 })
  expect(page?.reviews?.map((r) => r.stars).sort()).toEqual([2, 4, 5])
  // stars, text and date only: no ids, names, bookings or amounts
  for (const r of page!.reviews!) expect(Object.keys(r).sort()).toEqual(['date', 'stars', 'text'])
  // the provider sees the customer's rating on a request (the provider's visible reviews of them only)
  const req = (await pool.query("INSERT INTO requests (customer_id, provider_id, description, answer_by) VALUES ($1, $2, 'Hecke', now() + interval '3 days') RETURNING id", [U.other, ratedProviderId])).rows[0].id
  expect((await asUser(U.rated, (tx) => getRequest(tx, U.rated, req))).customerRating).toEqual({ average: 1, count: 1 })
  expect((await asUser(U.rated, (tx) => listRequests(tx, U.rated, 'provider'))).docs.find((r) => r.id === req)?.customerRating).toEqual({ average: 1, count: 1 })
  expect((await asUser(U.other, (tx) => getRequest(tx, U.other, req))).customerRating).toBeUndefined() // not on the customer's own view
  // the author's export lists what they wrote
  const exported = await asUser(U.other, (tx) => exportMyData(tx, U.other))
  expect(exported.reviews.map((r) => r.stars).sort()).toEqual([1, 2, 4, 5])
})

it('a hidden review leaves the average', async () => {
  await pool.query("UPDATE reviews SET hidden = true, hidden_reason = 'test' WHERE subject_id = $1 AND stars = 2", [U.rated])
  expect(await providerRating(db, ratedProviderId)).toEqual({ average: 4.5, count: 2 })
  const page = await publicPage(`${U.rated}-slug`)
  expect(page?.rating).toEqual({ average: 4.5, count: 2 })
  expect(page?.reviews?.map((r) => r.stars).sort()).toEqual([4, 5])
  // its author still sees it, marked hidden; nobody else does
  expect((await mine(U.other)).find((r) => r.stars === 2 && r.mine)?.hidden).toBe(true)
  expect((await mine(U.rated)).filter((r) => r.stars === 2)).toEqual([])
})
