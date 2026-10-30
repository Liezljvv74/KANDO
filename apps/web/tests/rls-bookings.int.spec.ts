import { afterAll, beforeAll, expect, it } from 'vitest'
import { asUser, pool } from '@kando/db'
import { sql } from 'drizzle-orm'
import { cleanupUsers, seedProvider, seedUser } from './helpers'

const ids = { customer: 'rb-cust', owner: 'rb-owner', other: 'rb-other' }
let providerId: string
let requestId: string
let quoteId: string
let otherProviderId: string
let serviceId: string // the price of an app-inserted booking comes from its service (bookings_fill_amount)

beforeAll(async () => {
  await cleanupUsers()
  for (const id of [ids.customer, ids.other]) await seedUser(id)
  providerId = await seedProvider(ids.owner, { name: 'Rb Owner', categoryId: (await pool.query('SELECT id FROM categories LIMIT 1')).rows[0]?.id ?? (await pool.query("INSERT INTO categories (slug) VALUES ('rb-cat') RETURNING id")).rows[0].id })
  otherProviderId = await seedProvider('rb-owner2', { name: 'Rb Two', categoryId: (await pool.query('SELECT id FROM categories LIMIT 1')).rows[0].id })
  serviceId = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [providerId])).rows[0].id
  requestId = (await pool.query("INSERT INTO requests (customer_id, provider_id, description, answer_by) VALUES ($1, $2, 'Fix the fence', now() + interval '7 days') RETURNING id", [ids.customer, providerId])).rows[0].id
  quoteId = (await pool.query("INSERT INTO quotes (request_id, provider_id, version, amount, currency, scope, expires_at) VALUES ($1, $2, 1, 100, 'EUR', 'Fence', now() + interval '14 days') RETURNING id", [requestId, providerId])).rows[0].id
  await pool.query(
    "INSERT INTO bookings (customer_id, provider_id, quote_id, source, status, start_at, duration_min, amount, currency, on_site) VALUES ($1, $2, $3, 'quote', 'proposed', now() + interval '3 days', 60, 100, 'EUR', false) RETURNING id",
    [ids.customer, providerId, quoteId],
  )
})

afterAll(cleanupUsers)

const countsFor = (uid: string | null) =>
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
      tx.execute(sql`INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, on_site)
        VALUES (${customer}, ${providerId}, ${serviceId}, 'direct', 'proposed', now() + interval '3 days', 60, false)`),
    )
  await expect(insert(ids.other, ids.customer)).rejects.toMatchObject({ cause: { message: expect.stringContaining('row-level security') } })
  await expect(insert(ids.customer, ids.customer)).resolves.toBeTruthy()
})

const rls = { cause: { message: expect.stringContaining('row-level security') } }
const run = (uid: string | null, q: ReturnType<typeof sql>) => asUser(uid, (tx) => tx.execute(q))
const future = sql`now() + interval '3 days'`
const insertBooking = (customer: string) =>
  sql`INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, on_site)
    VALUES (${customer}, ${providerId}, ${serviceId}, 'direct', 'proposed', ${future}, 60, false)`
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
  // a status move the domain makes still works (rls.ts APP_STATUS_MOVES)
  expect((await run(ids.owner, sql`UPDATE requests SET status = 'quoted' WHERE id = ${requestId}`)).rowCount).toBe(1)
  await pool.query("UPDATE requests SET status = 'open' WHERE id = $1", [requestId])
})

// Fresh rows on the owner connection, one per check, so no check sees another's state.
const one = async (text: string, params: unknown[]) => (await pool.query(text, params)).rows[0].id as string
const newRequest = (status = 'open') =>
  one("INSERT INTO requests (customer_id, provider_id, description, status, answer_by) VALUES ($1, $2, 'x', $3, now() + interval '7 days') RETURNING id", [ids.customer, providerId, status])
const newQuote = async () =>
  one("INSERT INTO quotes (request_id, provider_id, version, amount, currency, scope, expires_at) VALUES ($1, $2, 1, 100, 'EUR', 's', now() + interval '14 days') RETURNING id", [await newRequest('quoted'), providerId])
const newBooking = (status: 'proposed' | 'awaiting-payment', counterBy: 'provider' | 'customer' | null = null) =>
  one(
    `INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, on_site, answer_by, pay_by, accepted_at, counter_by)
     VALUES ($1, $2, $3, 'direct', $4, now() + interval '3 days', 60, false, now() + interval '1 day',
       ${status === 'proposed' ? 'NULL, NULL' : "now() + interval '1 day', now()"}, $5) RETURNING id`,
    [ids.customer, providerId, serviceId, status, counterBy],
  )
const notAppMove = { cause: { message: expect.stringContaining('not a move the app makes') } }

it('app_user cannot make a status move the domain does not make', async () => {
  // the listed moves pass, by the listed side
  const open = await newRequest()
  expect((await run(ids.owner, sql`UPDATE requests SET status = 'quoted' WHERE id = ${open}`)).rowCount).toBe(1)
  await expect(run(ids.owner, sql`UPDATE requests SET status = 'booked' WHERE id = ${await newRequest('quoted')}`)).rejects.toMatchObject(notAppMove)
  await expect(run(ids.customer, sql`UPDATE requests SET status = 'quoted' WHERE id = ${await newRequest()}`)).rejects.toMatchObject(notAppMove)
  await expect(run(ids.customer, sql`UPDATE quotes SET status = 'superseded' WHERE id = ${await newQuote()}`)).rejects.toMatchObject(notAppMove)
  await expect(run(ids.owner, sql`UPDATE quotes SET status = 'accepted' WHERE id = ${await newQuote()}`)).rejects.toMatchObject(notAppMove)
  await expect(run(ids.owner, sql`UPDATE bookings SET status = 'withdrawn' WHERE id = ${await newBooking('proposed')}`)).rejects.toMatchObject(notAppMove)
  for (const uid of [ids.customer, ids.owner])
    await expect(run(uid, sql`UPDATE bookings SET status = 'proposed' WHERE id = ${await newBooking('awaiting-payment')}`)).rejects.toMatchObject(notAppMove)
  expect((await run(ids.customer, sql`UPDATE bookings SET status = 'withdrawn' WHERE id = ${await newBooking('awaiting-payment')}`)).rowCount).toBe(1)
  // inserts start at the first status only
  await expect(run(ids.customer, sql`INSERT INTO requests (customer_id, provider_id, description, status, answer_by) VALUES (${ids.customer}, ${providerId}, 'x', 'booked', ${future})`)).rejects.toMatchObject(rls)
  await expect(run(ids.owner, sql`INSERT INTO quotes (request_id, provider_id, version, amount, currency, scope, status, expires_at) VALUES (${open}, ${providerId}, 1, 1, 'EUR', 's', 'accepted', ${future})`)).rejects.toMatchObject(rls)
  const book = (cols: ReturnType<typeof sql>) =>
    run(ids.customer, sql`INSERT INTO bookings (customer_id, provider_id, service_id, source, start_at, duration_min, on_site, status, pay_by, accepted_at)
      VALUES (${ids.customer}, ${providerId}, ${serviceId}, 'direct', ${future}, 60, false, ${cols})`)
  await expect(book(sql`'awaiting-payment', now() + interval '1 day', now()`)).rejects.toMatchObject(rls)
  await expect(book(sql`'proposed', now() + interval '1 day', NULL`)).rejects.toMatchObject(rls)
})

it('app_user may move a request to withdrawn (customer) and declined (provider), not the other way round', async () => {
  const move = (uid: string, id: string, to: string) => run(uid, sql`UPDATE requests SET status = ${to} WHERE id = ${id}`)
  for (const from of ['open', 'quoted']) {
    expect((await move(ids.customer, await newRequest(from), 'withdrawn')).rowCount).toBe(1)
    expect((await move(ids.owner, await newRequest(from), 'declined')).rowCount).toBe(1)
    await expect(move(ids.owner, await newRequest(from), 'withdrawn')).rejects.toMatchObject(notAppMove)
    await expect(move(ids.customer, await newRequest(from), 'declined')).rejects.toMatchObject(notAppMove)
  }
  // closing a quoted request declines its sent quote (trigger requests_close_quotes, past the app role's guard)
  const q = await newQuote()
  const r = (await pool.query('SELECT request_id FROM quotes WHERE id = $1', [q])).rows[0].request_id
  expect((await move(ids.customer, r, 'withdrawn')).rowCount).toBe(1)
  expect((await pool.query('SELECT status FROM quotes WHERE id = $1', [q])).rows[0].status).toBe('declined')
})

it('app_user cannot set a request from booked to quoted by hand', async () => {
  for (const uid of [ids.customer, ids.owner])
    await expect(run(uid, sql`UPDATE requests SET status = 'quoted' WHERE id = ${await newRequest('booked')}`)).rejects.toMatchObject(notAppMove)
})

it('accepted_at must be about now, and the address is frozen once the booking is no longer proposed', async () => {
  const back = await newBooking('proposed')
  const acceptAt = (id: string, at: string) =>
    run(ids.owner, sql.raw(`UPDATE bookings SET status = 'awaiting-payment', pay_by = start_at - interval '1 hour', accepted_at = ${at}, answer_by = NULL WHERE id = '${id}'`))
  await expect(acceptAt(back, "now() - interval '1 day'")).rejects.toMatchObject({ cause: { message: expect.stringContaining('accepted_at') } })
  expect((await acceptAt(back, 'now()')).rowCount).toBe(1)
  const addr = sql`UPDATE bookings SET address_city = 'Elsewhere' WHERE id = ${back}`
  await expect(run(ids.customer, addr)).rejects.toMatchObject({ cause: { message: expect.stringContaining('address') } })
  const open = await newBooking('proposed')
  expect((await run(ids.customer, sql`UPDATE bookings SET address_city = 'Elsewhere' WHERE id = ${open}`)).rowCount).toBe(1)
})

it('pay_by and the proposal columns move only with their transition', async () => {
  const proposed = await newBooking('proposed')
  await expect(run(ids.customer, sql`UPDATE bookings SET pay_by = start_at - interval '1 hour' WHERE id = ${proposed}`)).rejects.toMatchObject({ cause: { message: expect.stringContaining('pay_by') } })
  const accept = (payBy: ReturnType<typeof sql>) =>
    run(ids.owner, sql`UPDATE bookings SET status = 'awaiting-payment', pay_by = ${payBy}, accepted_at = now(), answer_by = NULL WHERE id = ${proposed}`)
  await expect(accept(sql`start_at + interval '1 day'`)).rejects.toMatchObject({ cause: { message: expect.stringContaining('pay_by') } })
  expect((await accept(sql`start_at - interval '1 hour'`)).rowCount).toBe(1) // the domain's accept passes
  for (const uid of [ids.customer, ids.owner]) {
    await expect(run(uid, sql`UPDATE bookings SET start_at = start_at + interval '1 day' WHERE id = ${proposed}`)).rejects.toMatchObject({ cause: { message: expect.stringContaining('start_at') } })
    await expect(run(uid, sql`UPDATE requests SET answer_by = answer_by + interval '30 days' WHERE id = ${requestId}`)).rejects.toMatchObject({ cause: { message: expect.stringContaining('answer_by') } })
  }
})

// Whose turn it is comes from counter_by, as in answerBooking: NULL = the customer proposed, so the provider answers.
const acceptSql = (id: string) => sql`UPDATE bookings SET status = 'awaiting-payment', pay_by = start_at - interval '1 hour', accepted_at = now(), answer_by = NULL, counter_by = NULL WHERE id = ${id}`
const declineSql = (id: string) => sql`UPDATE bookings SET status = 'declined', answer_by = NULL, counter_by = NULL WHERE id = ${id}`

it('only the answering side accepts or declines a proposal', async () => {
  // the customer's own fresh proposal: the customer cannot answer it, the provider can
  await expect(run(ids.customer, acceptSql(await newBooking('proposed')))).rejects.toMatchObject(notAppMove)
  await expect(run(ids.customer, declineSql(await newBooking('proposed')))).rejects.toMatchObject(notAppMove)
  expect((await run(ids.owner, acceptSql(await newBooking('proposed')))).rowCount).toBe(1)
  expect((await run(ids.owner, declineSql(await newBooking('proposed')))).rowCount).toBe(1)
  // the provider's counter: the provider cannot answer it, the customer can
  await expect(run(ids.owner, acceptSql(await newBooking('proposed', 'provider')))).rejects.toMatchObject(notAppMove)
  await expect(run(ids.owner, declineSql(await newBooking('proposed', 'provider')))).rejects.toMatchObject(notAppMove)
  expect((await run(ids.customer, acceptSql(await newBooking('proposed', 'provider')))).rowCount).toBe(1)
  expect((await run(ids.customer, declineSql(await newBooking('proposed', 'provider')))).rowCount).toBe(1)
  // the customer's counter: the provider answers again
  await expect(run(ids.customer, acceptSql(await newBooking('proposed', 'customer')))).rejects.toMatchObject(notAppMove)
  expect((await run(ids.owner, acceptSql(await newBooking('proposed', 'customer')))).rowCount).toBe(1)
  // the customer still withdraws their own proposal
  expect((await run(ids.customer, sql`UPDATE bookings SET status = 'withdrawn' WHERE id = ${await newBooking('proposed')}`)).rowCount).toBe(1)
})

it('only the answering side counters, as itself: the turn cannot be flipped to answer one\'s own proposal', async () => {
  const notCounter = { cause: { message: expect.stringContaining('counters') } }
  const counter = (uid: string, id: string, by: string) =>
    run(uid, sql`UPDATE bookings SET counter_by = ${by}, start_at = start_at + interval '1 day', answer_by = now() + interval '1 day' WHERE id = ${id}`)
  const fresh = await newBooking('proposed')
  await expect(run(ids.customer, sql`UPDATE bookings SET counter_by = 'provider' WHERE id = ${fresh}`)).rejects.toMatchObject(notCounter)
  await expect(counter(ids.customer, fresh, 'customer')).rejects.toMatchObject(notCounter) // not the customer's turn
  await expect(counter(ids.owner, fresh, 'customer')).rejects.toMatchObject(notCounter) // the provider counters as the provider
  await expect(run(ids.owner, sql`UPDATE bookings SET start_at = start_at + interval '1 day' WHERE id = ${fresh}`)).rejects.toMatchObject(notCounter)
  expect((await counter(ids.owner, fresh, 'provider')).rowCount).toBe(1) // the domain's counter passes
  await expect(run(ids.owner, sql`UPDATE bookings SET counter_by = 'customer' WHERE id = ${fresh}`)).rejects.toMatchObject(notCounter)
  expect((await counter(ids.customer, fresh, 'customer')).rowCount).toBe(1) // and the counter back
  expect((await run(ids.owner, acceptSql(fresh))).rowCount).toBe(1)
})

it('a third user cannot update or delete any of the three', async () => {
  for (const t of ['requests', 'quotes', 'bookings']) {
    expect((await run(ids.other, sql.raw(`UPDATE ${t} SET created_at = now()`))).rowCount).toBe(0)
    if (t === 'bookings') await expect(run(ids.other, sql.raw(`DELETE FROM ${t}`))).rejects.toMatchObject({ cause: { message: expect.stringContaining('permission denied') } }) // nobody deletes bookings as app_user (rls.ts NO_APP_DELETE)
    else expect((await run(ids.other, sql.raw(`DELETE FROM ${t}`))).rowCount).toBe(0)
  }
})
