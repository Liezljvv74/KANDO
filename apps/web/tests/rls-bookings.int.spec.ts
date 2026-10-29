import { afterAll, beforeAll, expect, it } from 'vitest'
import { asUser, pool } from '@kando/db'
import { sql } from 'drizzle-orm'
import { cleanupUsers, seedProvider, seedUser } from './helpers'

const ids = { customer: 'rb-cust', owner: 'rb-owner', other: 'rb-other' }
let providerId: string
let requestId: string
let quoteId: string
let bookingId: string

beforeAll(async () => {
  await cleanupUsers()
  for (const id of [ids.customer, ids.other]) await seedUser(id)
  providerId = await seedProvider(ids.owner, { name: 'Rb Owner', categoryId: (await pool.query('SELECT id FROM categories LIMIT 1')).rows[0]?.id ?? (await pool.query("INSERT INTO categories (slug) VALUES ('rb-cat') RETURNING id")).rows[0].id })
  requestId = (await pool.query("INSERT INTO requests (customer_id, provider_id, description, answer_by) VALUES ($1, $2, 'Fix the fence', now() + interval '7 days') RETURNING id", [ids.customer, providerId])).rows[0].id
  quoteId = (await pool.query("INSERT INTO quotes (request_id, provider_id, version, amount, currency, scope, expires_at) VALUES ($1, $2, 1, 100, 'EUR', 'Fence', now() + interval '14 days') RETURNING id", [requestId, providerId])).rows[0].id
  bookingId = (await pool.query(
    "INSERT INTO bookings (customer_id, provider_id, quote_id, source, status, start_at, duration_min, amount, currency, on_site) VALUES ($1, $2, $3, 'quote', 'proposed', now() + interval '3 days', 60, 100, 'EUR', false) RETURNING id",
    [ids.customer, providerId, quoteId],
  )).rows[0].id
})

afterAll(cleanupUsers)

const countsFor = (uid: string) =>
  asUser(uid, async (tx) => {
    const n = async (t: string) => (await tx.execute(sql.raw(`SELECT id FROM ${t}`))).rows.length
    return [await n('requests'), await n('quotes'), await n('bookings')]
  })

it('a customer and the provider owner can read their request, quote and booking', async () => {
  expect(await countsFor(ids.customer)).toEqual([1, 1, 1])
  expect(await countsFor(ids.owner)).toEqual([1, 1, 1])
})

it('a third user reads none of the three', async () => {
  expect(await countsFor(ids.other)).toEqual([0, 0, 0])
  expect(await countsFor(null as never)).toEqual([0, 0, 0])
})

it('app_user cannot insert a booking for another customer', async () => {
  const insert = (as: string, customer: string) =>
    asUser(as, (tx) =>
      tx.execute(sql`INSERT INTO bookings (customer_id, provider_id, source, status, start_at, duration_min, amount, currency, on_site)
        VALUES (${customer}, ${providerId}, 'direct', 'proposed', now() + interval '3 days', 60, 50, 'EUR', false)`),
    )
  await expect(insert(ids.other, ids.customer)).rejects.toMatchObject({ cause: { message: expect.stringContaining('row-level security') } })
  await expect(insert(ids.customer, ids.customer)).resolves.toBeTruthy()
  expect(bookingId).toBeTruthy()
})
