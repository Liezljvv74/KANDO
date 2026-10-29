import { afterAll, beforeAll, expect, it } from 'vitest'
import { asUser, pool } from '@kando/db'
import { sql } from 'drizzle-orm'
import { cleanupUsers, seedProvider, seedUser } from './helpers'

const ids = { customer: 'rb-cust', owner: 'rb-owner', other: 'rb-other' }
let providerId: string
let requestId: string
let quoteId: string
let bookingId: string
let otherProviderId: string

beforeAll(async () => {
  await cleanupUsers()
  for (const id of [ids.customer, ids.other]) await seedUser(id)
  providerId = await seedProvider(ids.owner, { name: 'Rb Owner', categoryId: (await pool.query('SELECT id FROM categories LIMIT 1')).rows[0]?.id ?? (await pool.query("INSERT INTO categories (slug) VALUES ('rb-cat') RETURNING id")).rows[0].id })
  otherProviderId = await seedProvider('rb-owner2', { name: 'Rb Two', categoryId: (await pool.query('SELECT id FROM categories LIMIT 1')).rows[0].id })
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
  expect(await countsFor(null)).toEqual([0, 0, 0])
})

it('app_user cannot insert a booking for another customer', async () => {
  const insert = (as: string, customer: string) =>
    asUser(as, (tx) =>
      tx.execute(sql`INSERT INTO bookings (customer_id, provider_id, source, status, start_at, duration_min, amount, currency, on_site)
        VALUES (${customer}, ${providerId}, 'direct', 'proposed', now() + interval '3 days', 60, 50, 'EUR', false)`),
    )
  await expect(insert(ids.other, ids.customer)).rejects.toMatchObject({ cause: { message: expect.stringContaining('row-level security') } })
  await expect(insert(ids.customer, ids.customer)).resolves.toBeTruthy()
})

const rls = { cause: { message: expect.stringContaining('row-level security') } }
const run = (uid: string | null, q: ReturnType<typeof sql>) => asUser(uid, (tx) => tx.execute(q))
const future = sql`now() + interval '3 days'`
const insertBooking = (customer: string) =>
  sql`INSERT INTO bookings (customer_id, provider_id, source, status, start_at, duration_min, amount, currency, on_site)
    VALUES (${customer}, ${providerId}, 'direct', 'proposed', ${future}, 60, 50, 'EUR', false)`
const insertRequest = (customer: string) =>
  sql`INSERT INTO requests (customer_id, provider_id, description, answer_by) VALUES (${customer}, ${providerId}, 'x', ${future})`
const insertQuote = (provider: string, request: string, version = 2) =>
  sql`INSERT INTO quotes (request_id, provider_id, version, amount, currency, scope, expires_at) VALUES (${request}, ${provider}, ${version}, 1, 'EUR', 's', ${future})`

it('the provider owner cannot forge a customer on a request or a booking', async () => {
  await expect(run(ids.owner, insertRequest(ids.other))).rejects.toMatchObject(rls)
  await expect(run(ids.owner, insertBooking(ids.other))).rejects.toMatchObject(rls)
})

it('a customer cannot forge a provider on a quote, and cannot quote at all', async () => {
  await expect(run(ids.customer, insertQuote(providerId, requestId))).rejects.toMatchObject(rls)
  await expect(run(ids.customer, insertQuote(otherProviderId, requestId))).rejects.toMatchObject(rls)
})

it("a provider cannot quote a request that is not addressed to them", async () => {
  await expect(run('rb-owner2', insertQuote(otherProviderId, requestId))).rejects.toMatchObject(rls)
})

it('the legitimate paths work: customer creates request and booking, provider owner quotes their request', async () => {
  await expect(run(ids.customer, insertRequest(ids.customer))).resolves.toBeTruthy()
  await expect(run(ids.customer, insertBooking(ids.customer))).resolves.toBeTruthy()
  await expect(run(ids.owner, insertQuote(providerId, requestId))).resolves.toBeTruthy()
  await expect(run(ids.owner, insertQuote(providerId, requestId))).rejects.toThrow() // version 2 again: unique per request
})

it('neither party can reassign customer_id or provider_id, request_id on a quote', async () => {
  const other = otherProviderId
  for (const uid of [ids.customer, ids.owner]) {
    await expect(run(uid, sql`UPDATE requests SET customer_id = ${ids.other}`)).rejects.toThrow()
    await expect(run(uid, sql`UPDATE bookings SET customer_id = ${ids.other}`)).rejects.toThrow()
    await expect(run(uid, sql`UPDATE bookings SET provider_id = ${other}`)).rejects.toThrow()
    await expect(run(uid, sql`UPDATE requests SET provider_id = ${other}`)).rejects.toThrow()
    await expect(run(uid, sql`UPDATE quotes SET provider_id = ${other}`)).rejects.toThrow()
    await expect(run(uid, sql`UPDATE quotes SET request_id = ${requestId}`)).resolves.toBeTruthy() // unchanged value is fine
  }
  // a status change by a party still works
  expect((await run(ids.customer, sql`UPDATE requests SET status = 'withdrawn' WHERE id = ${requestId}`)).rowCount).toBe(1)
  await pool.query("UPDATE requests SET status = 'open' WHERE id = $1", [requestId])
})

it('a third user cannot update or delete any of the three', async () => {
  for (const t of ['requests', 'quotes', 'bookings']) {
    expect((await run(ids.other, sql.raw(`UPDATE ${t} SET created_at = now()`))).rowCount).toBe(0)
    expect((await run(ids.other, sql.raw(`DELETE FROM ${t}`))).rowCount).toBe(0)
  }
})
