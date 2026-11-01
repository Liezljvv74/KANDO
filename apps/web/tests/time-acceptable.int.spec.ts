import { afterAll, beforeAll, expect, it } from 'vitest'
import { asUser, pool } from '@kando/db'
import { timeIsAcceptable } from '@kando/domain'
import { cleanupUsers, seedProvider, seedUser } from './helpers'

const ids = { cust: 'ta-cust', owner: 'ta-owner' }
let providerId: string
const now = new Date('2031-03-01T08:00:00.000Z')
const at = (h: number) => new Date(now.getTime() + h * 3_600_000)
const check = (o: { startAt: Date; durationMin?: number; onSite?: boolean; ignoreBookingId?: string }) =>
  asUser(ids.cust, (tx) => timeIsAcceptable(tx, { providerId, durationMin: 60, onSite: true, now, ...o }))
const refused = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    const r = e as Response
    return { status: r.status, error: (await r.json()).error }
  }
  return null
}

beforeAll(async () => {
  await cleanupUsers()
  await seedUser(ids.cust)
  providerId = await seedProvider(ids.owner, { name: 'Ta Owner', categoryId: (await pool.query('SELECT id FROM categories LIMIT 1')).rows[0]?.id ?? (await pool.query("INSERT INTO categories (slug) VALUES ('rb-cat') RETURNING id")).rows[0].id })
  const book = (status: string, startH: number, onSite: boolean, payBy: string | null) =>
    pool.query(
      `INSERT INTO bookings (customer_id, provider_id, source, status, start_at, duration_min, amount, currency, on_site, pay_by, accepted_at)
       VALUES ($1, $2, 'direct', $3, $4, 60, 50, 'EUR', $5, $6, CASE WHEN $6::timestamptz IS NULL THEN NULL ELSE $7::timestamptz END)`,
      [ids.cust, providerId, status, at(startH), onSite, payBy, now],
    )
  await book('awaiting-payment', 48, true, at(60).toISOString()) // on site, 48h to 49h, payment window open
  await book('confirmed', 100, false, null) // remote, paid, 100h to 101h
})
afterAll(cleanupUsers)

it('a free time in the future is acceptable', async () => {
  expect(await refused(check({ startAt: at(24) }))).toBeNull()
})
it('a time in the past is refused with start-in-past', async () => {
  expect(await refused(check({ startAt: at(-1) }))).toEqual({ status: 400, error: 'start-in-past' })
})
it('a time more than a year ahead is refused with start-too-far', async () => {
  expect(await refused(check({ startAt: at(24 * 400) }))).toEqual({ status: 400, error: 'start-too-far' })
})
it('a remote time is refused when the provider does not work remotely', async () => {
  expect(await refused(check({ startAt: at(24), onSite: false }))).toEqual({ status: 400, error: 'on-site-required' })
})
it('a time overlapping an awaiting-payment booking is refused with slot-pending', async () => {
  expect(await refused(check({ startAt: at(48) }))).toEqual({ status: 409, error: 'slot-pending' })
})
it('the 30-minute buffer applies between two on-site jobs, and touching at the buffer is free', async () => {
  expect(await refused(check({ startAt: new Date(at(49).getTime() + 10 * 60_000) }))).toEqual({ status: 409, error: 'slot-pending' })
  expect(await refused(check({ startAt: new Date(at(49).getTime() + 30 * 60_000) }))).toBeNull()
})
it('a booking can be ignored (it is the one being changed)', async () => {
  const id = (await pool.query("SELECT id FROM bookings WHERE provider_id = $1 AND status = 'awaiting-payment'", [providerId])).rows[0].id
  expect(await refused(check({ startAt: at(48), ignoreBookingId: id }))).toBeNull()
})
