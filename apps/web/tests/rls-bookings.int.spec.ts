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
    "INSERT INTO bookings (customer_id, provider_id, quote_id, source, status, start_at, duration_min, amount, currency, on_site, pay_by, accepted_at) VALUES ($1, $2, $3, 'quote', 'awaiting-payment', now() + interval '3 days', 60, 100, 'EUR', false, now() + interval '1 day', now()) RETURNING id",
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

it('app_user cannot insert a booking at all: not for another customer, not for themselves, not as the provider', async () => {
  const insert = (as: string, customer: string) =>
    asUser(as, (tx) =>
      tx.execute(sql`INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, on_site)
        VALUES (${customer}, ${providerId}, ${serviceId}, 'direct', 'awaiting-time', now() + interval '3 days', 60, false)`),
    )
  // layer 1: no INSERT privilege (permission denied); layer 2: the deny-all insert policy stays
  const denied = { cause: { message: expect.stringContaining('permission denied') } }
  await expect(insert(ids.other, ids.customer)).rejects.toMatchObject(denied)
  await expect(insert(ids.customer, ids.customer)).rejects.toMatchObject(denied)
  await expect(insert(ids.owner, ids.customer)).rejects.toMatchObject(denied)
  const priv = await pool.query("SELECT has_table_privilege('app_user', 'bookings', 'INSERT') AS t, has_any_column_privilege('app_user', 'bookings', 'INSERT') AS c")
  expect(priv.rows[0]).toEqual({ t: false, c: false })
  const pol = await pool.query("SELECT 1 FROM pg_policies WHERE tablename = 'bookings' AND policyname = 'insert_rule' AND cmd = 'INSERT'")
  expect(pol.rowCount).toBe(1)
})

const rls = { cause: { message: expect.stringContaining('row-level security') } }
const permission = { cause: { message: expect.stringContaining('permission denied') } }
const run = (uid: string | null, q: ReturnType<typeof sql>) => asUser(uid, (tx) => tx.execute(q))
const future = sql`now() + interval '3 days'`
const insertBooking = (customer: string) =>
  sql`INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, on_site)
    VALUES (${customer}, ${providerId}, ${serviceId}, 'direct', 'awaiting-time', ${future}, 60, false)`
const insertRequest = (customer: string) =>
  sql`INSERT INTO requests (customer_id, provider_id, description, answer_by) VALUES (${customer}, ${providerId}, 'x', ${future})`
const insertQuote = (provider: string, request: string, version = 2) =>
  sql`INSERT INTO quotes (request_id, provider_id, version, amount, currency, scope, expires_at) VALUES (${request}, ${provider}, ${version}, 1, 'EUR', 's', ${future})`

it('the provider owner cannot forge a customer on a request or a booking', async () => {
  await expect(run(ids.owner, insertRequest(ids.other))).rejects.toMatchObject(rls)
  await expect(run(ids.owner, insertBooking(ids.other))).rejects.toMatchObject({ cause: { message: expect.stringContaining('permission denied') } })
})

it('a customer cannot forge a provider on a quote, and cannot quote at all', async () => {
  await expect(run(ids.customer, insertQuote(providerId, requestId))).rejects.toMatchObject(rls)
  await expect(run(ids.customer, insertQuote(otherProviderId, requestId))).rejects.toMatchObject(rls)
})

it("a provider cannot quote a request that is not addressed to them", async () => {
  await expect(run('rb-owner2', insertQuote(otherProviderId, requestId))).rejects.toMatchObject(rls)
})

it('the legitimate paths work: customer creates a request, provider owner quotes their request', async () => {
  await expect(run(ids.customer, insertRequest(ids.customer))).resolves.toBeTruthy()
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
const newBooking = (status: 'awaiting-time' | 'awaiting-payment') =>
  one(
    `INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, on_site, answer_by, pay_by, accepted_at)
     VALUES ($1, $2, $3, 'direct', $4, now() + interval '3 days', 60, false, now() + interval '1 day',
       ${status === 'awaiting-time' ? 'NULL, NULL' : "now() + interval '1 day', now()"}) RETURNING id`,
    [ids.customer, providerId, serviceId, status],
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
  for (const status of ['awaiting-time', 'awaiting-payment'] as const) {
    await expect(run(ids.owner, sql`UPDATE bookings SET status = 'withdrawn' WHERE id = ${await newBooking(status)}`)).rejects.toMatchObject(notAppMove) // only the customer withdraws
    for (const uid of [ids.customer, ids.owner])
      for (const to of ['expired', 'declined', 'awaiting-payment', 'awaiting-time'])
        if (to !== status) await expect(run(uid, sql`UPDATE bookings SET status = ${to} WHERE id = ${await newBooking(status)}`), `${uid} ${status}>${to}`).rejects.toMatchObject(notAppMove)
    expect((await run(ids.customer, sql`UPDATE bookings SET status = 'withdrawn' WHERE id = ${await newBooking(status)}`)).rowCount).toBe(1)
  }
  // inserts start at the first status only
  await expect(run(ids.customer, sql`INSERT INTO requests (customer_id, provider_id, description, status, answer_by) VALUES (${ids.customer}, ${providerId}, 'x', 'booked', ${future})`)).rejects.toMatchObject(rls)
  await expect(run(ids.owner, sql`INSERT INTO quotes (request_id, provider_id, version, amount, currency, scope, status, expires_at) VALUES (${open}, ${providerId}, 1, 1, 'EUR', 's', 'accepted', ${future})`)).rejects.toMatchObject(rls)
  const book = (cols: ReturnType<typeof sql>) =>
    run(ids.customer, sql`INSERT INTO bookings (customer_id, provider_id, service_id, source, start_at, duration_min, on_site, status, pay_by, accepted_at)
      VALUES (${ids.customer}, ${providerId}, ${serviceId}, 'direct', ${future}, 60, false, ${cols})`)
  await expect(book(sql`'awaiting-payment', now() + interval '1 day', now()`)).rejects.toMatchObject(permission)
  await expect(book(sql`'awaiting-time', NULL, NULL`)).rejects.toMatchObject(permission)
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

it('the app role cannot change pay_by, accepted_at, answer_by, start_at, duration_min, on_site or the address of a booking', async () => {
  const changes = ["pay_by = now() + interval '30 days'", "accepted_at = now()", "answer_by = now() + interval '30 days'", "start_at = start_at + interval '1 day'", 'duration_min = duration_min + 30', 'on_site = NOT on_site', "address_city = 'Elsewhere'"]
  for (const status of ['awaiting-time', 'awaiting-payment'] as const) {
    const id = await newBooking(status)
    for (const uid of [ids.customer, ids.owner])
      for (const change of changes) await expect(run(uid, sql.raw(`UPDATE bookings SET ${change} WHERE id = '${id}'`)), `${uid} ${status} ${change}`).rejects.toMatchObject({ cause: { message: expect.stringContaining('not changed by the app') } })
    // the owner connection (the domain after its checks) still sets them
    expect((await pool.query(`UPDATE bookings SET pay_by = pay_by + interval '1 hour', start_at = start_at + interval '1 day' WHERE id = $1`, [id])).rowCount).toBe(1)
  }
})

it("a request's answer_by cannot be moved by either party", async () => {
  for (const uid of [ids.customer, ids.owner])
    await expect(run(uid, sql`UPDATE requests SET answer_by = answer_by + interval '30 days' WHERE id = ${requestId}`)).rejects.toMatchObject({ cause: { message: expect.stringContaining('answer_by') } })
})


it('a third user cannot update or delete any of the three', async () => {
  for (const t of ['requests', 'quotes', 'bookings']) {
    expect((await run(ids.other, sql.raw(`UPDATE ${t} SET created_at = now()`))).rowCount).toBe(0)
    if (t === 'bookings') await expect(run(ids.other, sql.raw(`DELETE FROM ${t}`))).rejects.toMatchObject({ cause: { message: expect.stringContaining('permission denied') } }) // nobody deletes bookings as app_user (rls.ts NO_APP_DELETE)
    else expect((await run(ids.other, sql.raw(`DELETE FROM ${t}`))).rowCount).toBe(0)
  }
})

// Flow 1 (one request-to-booked flow): the request carries the customer's time; a booking can wait for its time.
it('a request stores the customer\'s time and place, and a new request starts at revision 0', async () => {
  const [r] = (await pool.query(
    `INSERT INTO requests (customer_id, provider_id, description, answer_by, start_at, duration_min, on_site, address_postcode, note)
     VALUES ($1, $2, 'Time test', now() + interval '3 days', now() + interval '5 days', 90, true, '04109', 'Back door') RETURNING duration_min, on_site, address_postcode, note, revision`,
    [ids.customer, providerId],
  )).rows
  expect(r).toEqual({ duration_min: 90, on_site: true, address_postcode: '04109', note: 'Back door', revision: 0 })
})

it('a booking can wait for its time (awaiting-time) and then holds no slot', async () => {
  const [b] = (await pool.query(
    `INSERT INTO bookings (customer_id, provider_id, quote_id, source, status, start_at, duration_min, amount, currency, on_site, answer_by)
     VALUES ($1, $2, $3, 'quote', 'awaiting-time', now() + interval '50 days', 60, 100, 'EUR', false, now() + interval '7 days') RETURNING id, status, pay_by`,
    [ids.customer, providerId, quoteId],
  )).rows
  expect(b).toMatchObject({ status: 'awaiting-time', pay_by: null })
  // a window around that booking only (other tests in this file leave bookings of their own): only paid and awaiting-payment bookings hold the provider's time
  const busy = (await pool.query(`SELECT * FROM busy_times($1::uuid, now() + interval '49 days', now() + interval '51 days')`, [providerId])).rows
  expect(busy).toEqual([])
})

it('the customer may withdraw an awaiting-time booking, the provider may not', async () => {
  const id = (await pool.query(
    `INSERT INTO bookings (customer_id, provider_id, quote_id, source, status, start_at, duration_min, amount, currency, on_site, answer_by)
     VALUES ($1, $2, $3, 'quote', 'awaiting-time', now() + interval '3 days', 60, 100, 'EUR', false, now() + interval '7 days') RETURNING id`,
    [ids.customer, providerId, quoteId],
  )).rows[0].id
  await expect(run(ids.owner, sql`UPDATE bookings SET status = 'withdrawn' WHERE id = ${id}`)).rejects.toBeTruthy()
  await expect(run(ids.customer, sql`UPDATE bookings SET status = 'withdrawn' WHERE id = ${id}`)).resolves.toBeTruthy()
})

it('the app role cannot set the agree-the-time columns of a booking', async () => {
  const id = (await pool.query(
    `INSERT INTO bookings (customer_id, provider_id, quote_id, source, status, start_at, duration_min, amount, currency, on_site, answer_by)
     VALUES ($1, $2, $3, 'quote', 'awaiting-time', now() + interval '3 days', 60, 100, 'EUR', false, now() + interval '7 days') RETURNING id`,
    [ids.customer, providerId, quoteId],
  )).rows[0].id
  await expect(run(ids.customer, sql`UPDATE bookings SET time_proposed_by = 'customer' WHERE id = ${id}`)).rejects.toBeTruthy()
})

it('only the two parties read a quote document, and the app role cannot write one', async () => {
  const qd = (await pool.query(
    `INSERT INTO quote_documents (quote_id, provider_id, customer_id, number, issued_at, draft) VALUES ($1, $2, $3, 'RB-TEST-0001', now(), '{}') RETURNING id`,
    [quoteId, providerId, ids.customer],
  )).rows[0].id
  const read = async (uid: string | null) => (await run(uid, sql`SELECT id FROM quote_documents WHERE id = ${qd}`)).rows.length
  expect([await read(ids.customer), await read(ids.owner), await read(ids.other), await read(null)]).toEqual([1, 1, 0, 0])
  await expect(run(ids.owner, sql`UPDATE quote_documents SET number = 'X' WHERE id = ${qd}`)).rejects.toBeTruthy()
  await expect(run(ids.owner, sql`DELETE FROM quote_documents WHERE id = ${qd}`)).rejects.toBeTruthy()
})
