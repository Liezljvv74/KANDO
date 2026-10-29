import { afterAll, beforeAll, expect, it } from 'vitest'
import { asUser, db, pool } from '@kando/db'
import { createRequest, listBookings, listRequests, runDueTimers } from '@kando/domain'
import { cleanupUsers, seedBase, seedProvider, seedUser } from './helpers'

const U = { cust: 'tm-cust', cust2: 'tm-cust2', owner: 'tm-owner', owner2: 'tm-owner2' }
let prov: string, prov2: string, service: string
const NOW = new Date('2027-03-10T12:00:00Z')
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString()
const run = (h: number) => runDueTimers(db, new Date(NOW.getTime() + h * 3_600_000))

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  await seedUser(U.cust)
  await seedUser(U.cust2)
  prov = await seedProvider(U.owner, { name: 'Tm Owner', categoryId })
  prov2 = await seedProvider(U.owner2, { name: 'Tm Owner2', categoryId })
  service = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [prov])).rows[0].id
})
afterAll(cleanupUsers)

const clean = async () => {
  await pool.query('DELETE FROM notifications WHERE user_id LIKE $1', ['tm-%'])
  await pool.query('DELETE FROM bookings WHERE customer_id = ANY($1)', [[U.cust, U.cust2]])
  await pool.query('DELETE FROM requests WHERE customer_id = ANY($1)', [[U.cust, U.cust2]])
}
const request = async (providerId: string, answerBy: string, status = 'open', cust = U.cust) =>
  (await pool.query("INSERT INTO requests (customer_id, provider_id, description, status, answer_by) VALUES ($1, $2, 'x', $3, $4) RETURNING id", [cust, providerId, status, answerBy])).rows[0].id as string
const booking = async (status: string, o: { answerBy?: string; payBy?: string; acceptedAt?: string; startAt?: string } = {}) =>
  (
    await pool.query(
      "INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, amount, answer_by, pay_by, updated_at) VALUES ($1, $2, $3, 'direct', $4, $5, 60, 10, $6, $7, COALESCE($8::timestamptz, now())) RETURNING id",
      [U.cust, prov, service, status, o.startAt ?? at(24 * 20), o.answerBy ?? null, o.payBy ?? null, o.acceptedAt ?? null],
    )
  ).rows[0].id as string
const status = async (table: string, id: string) => (await pool.query(`SELECT status FROM ${table} WHERE id = $1`, [id])).rows[0].status as string
const notes = async (kind: string) => (await pool.query('SELECT user_id, payload FROM notifications WHERE kind = $1 AND user_id LIKE $2 ORDER BY user_id', [kind, 'tm-%'])).rows

it('a request open 3 days and 1 minute expires and the customer is notified', async () => {
  await clean()
  // created through createRequest: its own 3-day answerBy decides
  const make = async (description: string, createdAt: Date, providerId = prov) => (await asUser(U.cust, (tx) => createRequest(tx, U.cust, { providerId, description }, createdAt))).id
  const old = await make('old request', new Date(NOW.getTime() - 3 * 86_400_000 - 60_000))
  const fresh = await make('fresh request', new Date(NOW.getTime() - 3 * 86_400_000 + 60_000), prov2) // another provider: one open request per pair
  expect((await run(0)).requestsExpired).toBeGreaterThanOrEqual(1)
  expect(await status('requests', old)).toBe('expired')
  expect(await status('requests', fresh)).toBe('open')
  expect(await notes('request-expired')).toEqual([{ user_id: U.cust, payload: { requestId: old } }])
})

it('running the timers twice changes and notifies nothing the second time', async () => {
  await clean()
  await request(prov, at(-1))
  await booking('proposed', { answerBy: at(-1) })
  await booking('awaiting-payment', { payBy: at(-1) })
  await run(0)
  const count = async () => Number((await pool.query('SELECT count(*) FROM notifications WHERE user_id LIKE $1', ['tm-%'])).rows[0].count)
  const after = await count()
  expect(await run(0)).toEqual({ requestsExpired: 0, quotesExpired: 0, proposalsLapsed: 0, unpaidExpired: 0, remindersSent: 0, ignoredNotices: 0 }) // the first run took everything due
  expect(await count()).toBe(after)
  expect(after).toBe(4) // request, proposal, unpaid (customer and provider)
})

it('a run two days late still expires correctly', async () => {
  await clean()
  const r = await request(prov, at(-1))
  const b = await booking('awaiting-payment', { payBy: at(-1) })
  await run(48)
  expect(await status('requests', r)).toBe('expired')
  expect(await status('bookings', b)).toBe('expired')
})

it('sent quotes past expiresAt expire and the request stays quoted', async () => {
  await clean()
  const r = await request(prov, at(24), 'quoted')
  const q = (await pool.query("INSERT INTO quotes (request_id, provider_id, amount, scope, expires_at) VALUES ($1, $2, 50, 's', $3) RETURNING id", [r, prov, at(-1)])).rows[0].id
  await run(0)
  expect(await status('quotes', q)).toBe('expired')
  expect(await status('requests', r)).toBe('quoted')
})

it('three expired requests in a month create exactly one requests-ignored notice', async () => {
  await clean()
  for (let i = 0; i < 3; i++) await request(prov, at(-1 - i))
  await request(prov2, at(-1)) // a provider with one is not flagged
  await run(0)
  expect((await notes('requests-ignored')).map((n) => n.user_id)).toEqual([U.owner])
  await request(prov, at(-2))
  await run(24) // same window: no second notice
  expect(await notes('requests-ignored')).toHaveLength(1)
})

it('quote reminder is sent once, one day before expiry', async () => {
  await clean()
  const r = await request(prov, at(24 * 5), 'quoted')
  await pool.query("INSERT INTO quotes (request_id, provider_id, amount, scope, expires_at) VALUES ($1, $2, 50, 's', $3)", [r, prov, at(30)])
  await run(0) // 30h left
  expect(await notes('quote-expiring')).toHaveLength(0)
  await run(7) // 23h left
  expect(await notes('quote-expiring')).toHaveLength(1)
  await run(8)
  expect((await notes('quote-expiring')).map((n) => n.user_id)).toEqual([U.cust])
})

it('payment reminders: halfway once, 3 hours before once; none under 6 hours or once expired', async () => {
  await clean()
  const b = await booking('awaiting-payment', { acceptedAt: at(0), payBy: at(48) })
  const short = await booking('awaiting-payment', { acceptedAt: at(0), payBy: at(5) }) // under 6h: no halfway reminder
  const sent = async (h: number) => {
    const before = (await notes('payment-reminder')).length
    await run(h)
    return (await notes('payment-reminder')).length - before
  }
  expect(await sent(10)).toBe(0)
  expect(await sent(24)).toBe(1) // halfway of the 48h booking
  expect(await sent(25)).toBe(0)
  expect(await sent(46)).toBe(1) // 3h before payBy
  expect(await sent(47)).toBe(0)
  expect((await notes('payment-reminder')).map((n) => n.payload)).toEqual([{ bookingId: b }, { bookingId: b }])
  expect(await status('bookings', short)).toBe('expired') // expired at its deadline without a reminder
  expect(await sent(49)).toBe(0)
  expect(await status('bookings', b)).toBe('expired')
})

it('unpaid awaiting-payment past payBy expires and frees the time', async () => {
  await clean()
  const b = await booking('awaiting-payment', { payBy: at(-1), startAt: at(24 * 20) })
  const busy = async () => (await pool.query('SELECT * FROM busy_times($1::uuid, $2::timestamptz, $3::timestamptz)', [prov, at(24 * 19), at(24 * 21)])).rows.length
  expect(await busy()).toBe(1) // window still open by the database clock
  await pool.query("UPDATE bookings SET pay_by = now() - interval '1 minute' WHERE id = $1", [b])
  expect(await busy()).toBe(0) // the lapsed window frees the time at once, before any sweep
  expect(await status('bookings', b)).toBe('awaiting-payment')
  await run(0)
  expect(await status('bookings', b)).toBe('expired')
  expect(await busy()).toBe(0)
  expect((await notes('booking-expired')).map((n) => n.user_id).sort()).toEqual([U.cust, U.owner])
})

it('two overlapping runs create exactly one requests-ignored notice (the lock serialises them)', async () => {
  await clean()
  for (let i = 0; i < 3; i++) await request(prov, at(-1 - i), 'expired') // already expired: every run reaches the notice step
  await pool.query('UPDATE requests SET updated_at = $1 WHERE customer_id = $2', [at(-1), U.cust])
  const holder = await pool.connect() // someone else holds the notice lock: both runs must wait for it
  await holder.query('BEGIN')
  await holder.query("SELECT pg_advisory_xact_lock(hashtext('requests_ignored'))")
  let finished = 0
  const runs = Promise.all([run(0), run(0)].map((p) => p.then(() => finished++)))
  await new Promise((r) => setTimeout(r, 500))
  expect(finished).toBe(0) // without the lock they would be done by now
  await holder.query('COMMIT')
  holder.release()
  await runs
  expect((await notes('requests-ignored')).map((n) => n.user_id)).toEqual([U.owner])
})

it('listRequests and listBookings show a just-due row as expired and leave other users rows alone', async () => {
  await clean()
  const past = () => new Date(Date.now() - 60_000).toISOString()
  const mine = await request(prov, past())
  const theirs = await request(prov, past(), 'open', U.cust2)
  const b = await booking('proposed', { answerBy: past() })
  const reqs = await asUser(U.cust, (tx) => listRequests(tx, U.cust, 'customer'))
  expect(reqs.find((r) => r.id === mine)?.status).toBe('expired')
  expect(await status('requests', theirs)).toBe('open') // another customer's due row is untouched
  expect((await asUser(U.cust, (tx) => listBookings(tx, U.cust, 'customer'))).find((x) => x.id === b)?.status).toBe('expired')
  const b2 = await booking('awaiting-payment', { payBy: past() }) // the provider side is lazy too
  expect((await asUser(U.owner, (tx) => listBookings(tx, U.owner, 'provider'))).find((x) => x.id === b2)?.status).toBe('expired')
})

it('the lazy path sends no reminders and no ignored notice, but does write expiry notices', async () => {
  await clean()
  const soon = await booking('awaiting-payment', { acceptedAt: new Date(Date.now() - 20 * 3_600_000).toISOString(), payBy: new Date(Date.now() + 3_600_000).toISOString() }) // inside the last 3 hours
  for (let i = 0; i < 3; i++) await request(prov, new Date(Date.now() - 60_000 * (i + 1)).toISOString())
  await asUser(U.cust, (tx) => listBookings(tx, U.cust, 'customer'))
  await asUser(U.owner, (tx) => listRequests(tx, U.owner, 'provider'))
  expect(await status('bookings', soon)).toBe('awaiting-payment')
  expect(await notes('payment-reminder')).toHaveLength(0)
  expect(await notes('requests-ignored')).toHaveLength(0)
  expect(await notes('request-expired')).toHaveLength(3)
})
