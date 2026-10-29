import { afterAll, beforeAll, expect, it } from 'vitest'
import { db, pool } from '@kando/db'
import { runDueTimers } from '@kando/domain'
import { cleanupUsers, seedBase, seedProvider, seedUser } from './helpers'

const U = { cust: 'tm-cust', owner: 'tm-owner', owner2: 'tm-owner2' }
let prov: string, prov2: string, service: string
const NOW = new Date('2027-03-10T12:00:00Z')
const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString()
const run = (h: number) => runDueTimers(db, new Date(NOW.getTime() + h * 3_600_000))

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  await seedUser(U.cust)
  prov = await seedProvider(U.owner, { name: 'Tm Owner', categoryId })
  prov2 = await seedProvider(U.owner2, { name: 'Tm Owner2', categoryId })
  service = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [prov])).rows[0].id
})
afterAll(cleanupUsers)

const clean = async () => {
  await pool.query('DELETE FROM notifications WHERE user_id LIKE $1', ['tm-%'])
  await pool.query('DELETE FROM bookings WHERE customer_id = $1', [U.cust])
  await pool.query('DELETE FROM requests WHERE customer_id = $1', [U.cust])
}
const request = async (providerId: string, answerBy: string, status = 'open') =>
  (await pool.query("INSERT INTO requests (customer_id, provider_id, description, status, answer_by) VALUES ($1, $2, 'x', $3, $4) RETURNING id", [U.cust, providerId, status, answerBy])).rows[0].id as string
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
  const old = await request(prov, new Date(NOW.getTime() - 60_000).toISOString()) // answer_by passed a minute ago
  const fresh = await request(prov, at(24))
  expect((await run(0)).requestsExpired).toBe(1)
  expect(await status('requests', old)).toBe('expired')
  expect(await status('requests', fresh)).toBe('open')
  expect(await notes('request-expired')).toEqual([{ user_id: U.cust, payload: { requestId: old } }])
})

it('running the timers twice changes and notifies nothing the second time', async () => {
  await clean()
  await request(prov, at(-1))
  await booking('proposed', { answerBy: at(-1) })
  await booking('awaiting-payment', { payBy: at(-1) })
  expect(await run(0)).toMatchObject({ requestsExpired: 1, proposalsLapsed: 1, unpaidExpired: 1 })
  const count = async () => Number((await pool.query('SELECT count(*) FROM notifications WHERE user_id LIKE $1', ['tm-%'])).rows[0].count)
  const after = await count()
  expect(await run(0)).toEqual({ requestsExpired: 0, quotesExpired: 0, proposalsLapsed: 0, unpaidExpired: 0, remindersSent: 0, ignoredNotices: 0 })
  expect(await count()).toBe(after)
})

it('a run two days late still expires correctly', async () => {
  await clean()
  const r = await request(prov, at(-1))
  const b = await booking('awaiting-payment', { payBy: at(-1) })
  expect(await run(48)).toMatchObject({ requestsExpired: 1, unpaidExpired: 1 })
  expect(await status('requests', r)).toBe('expired')
  expect(await status('bookings', b)).toBe('expired')
})

it('sent quotes past expiresAt expire and the request stays quoted', async () => {
  await clean()
  const r = await request(prov, at(24), 'quoted')
  const q = (await pool.query("INSERT INTO quotes (request_id, provider_id, amount, scope, expires_at) VALUES ($1, $2, 50, 's', $3) RETURNING id", [r, prov, at(-1)])).rows[0].id
  expect((await run(0)).quotesExpired).toBe(1)
  expect(await status('quotes', q)).toBe('expired')
  expect(await status('requests', r)).toBe('quoted')
})

it('three expired requests in a month create exactly one requests-ignored notice', async () => {
  await clean()
  for (let i = 0; i < 3; i++) await request(prov, at(-1 - i))
  await request(prov2, at(-1)) // a provider with one is not flagged
  expect((await run(0)).ignoredNotices).toBe(1)
  expect((await notes('requests-ignored')).map((n) => n.user_id)).toEqual([U.owner])
  await request(prov, at(-2))
  expect((await run(24)).ignoredNotices).toBe(0) // same window: no second notice
  expect(await notes('requests-ignored')).toHaveLength(1)
})

it('quote reminder is sent once, one day before expiry', async () => {
  await clean()
  const r = await request(prov, at(24 * 5), 'quoted')
  await pool.query("INSERT INTO quotes (request_id, provider_id, amount, scope, expires_at) VALUES ($1, $2, 50, 's', $3)", [r, prov, at(30)])
  expect((await run(0)).remindersSent).toBe(0) // 30h left
  expect((await run(7)).remindersSent).toBe(1) // 23h left
  expect((await run(8)).remindersSent).toBe(0)
  expect((await notes('quote-expiring')).map((n) => n.user_id)).toEqual([U.cust])
})

it('payment reminders: halfway once, 3 hours before once; none under 6 hours or once expired', async () => {
  await clean()
  const b = await booking('awaiting-payment', { acceptedAt: at(0), payBy: at(48) })
  const short = await booking('awaiting-payment', { acceptedAt: at(0), payBy: at(5) }) // under 6h: no halfway reminder
  expect((await run(10)).remindersSent).toBe(0)
  expect((await run(24)).remindersSent).toBe(1) // halfway of the 48h booking
  expect((await run(25)).remindersSent).toBe(0)
  expect((await run(46)).remindersSent).toBe(1) // 3h before payBy
  expect((await run(47)).remindersSent).toBe(0)
  expect((await notes('payment-reminder')).map((n) => n.payload)).toEqual([{ bookingId: b }, { bookingId: b }])
  expect(await status('bookings', short)).toBe('expired') // expired at its deadline without a reminder
  expect((await run(49)).remindersSent).toBe(0)
  expect(await status('bookings', b)).toBe('expired')
})

it('unpaid awaiting-payment past payBy expires and frees the time', async () => {
  await clean()
  const b = await booking('awaiting-payment', { payBy: at(-1), startAt: at(24 * 20) })
  const busy = async () => (await pool.query('SELECT * FROM busy_times($1::uuid, $2::timestamptz, $3::timestamptz)', [prov, at(24 * 19), at(24 * 21)])).rows.length
  expect(await busy()).toBe(1)
  await run(0)
  expect(await status('bookings', b)).toBe('expired')
  expect(await busy()).toBe(0)
  expect((await notes('booking-expired')).map((n) => n.user_id).sort()).toEqual([U.cust, U.owner])
})
