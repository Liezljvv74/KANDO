import { afterAll, beforeAll, expect, it } from 'vitest'
import { getTableColumns, sql } from 'drizzle-orm'
import { asUser, bookingAppInsert, bookings, COLUMN_STAFF_ONLY, OWNER_ONLY_BOOKING_STATUSES, pool } from '@kando/db'
import { cleanupUsers, seedProvider, seedUser } from './helpers'

const ids = { customer: 'rp-cust', other: 'rp-other', owner: 'rp-owner', owner2: 'rp-owner2' }
let providerId: string
let otherProviderId: string
let serviceId: string
let otherServiceId: string
let requestId: string
let quoteId: string
let otherCustomersQuoteId: string
let otherProvidersQuoteId: string
let bookingId: string

const rls = { cause: { message: expect.stringContaining('row-level security') } }
const denied = { cause: { message: expect.stringContaining('permission denied') } }
const run = (uid: string | null, q: ReturnType<typeof sql>) => asUser(uid, (tx) => tx.execute(q))
const future = sql`now() + interval '3 days'`
const paymentCodeOnly = { cause: { message: expect.stringMatching(/confirmed.*payment code only/) } }
const unchangeable = { cause: { message: expect.stringContaining('cannot be changed') } }

beforeAll(async () => {
  await cleanupUsers()
  for (const id of [ids.customer, ids.other]) await seedUser(id)
  const categoryId = (await pool.query('SELECT id FROM categories LIMIT 1')).rows[0]?.id ?? (await pool.query("INSERT INTO categories (slug) VALUES ('rp-cat') RETURNING id")).rows[0].id
  providerId = await seedProvider(ids.owner, { name: 'Rp Owner', categoryId, price: 10 })
  otherProviderId = await seedProvider(ids.owner2, { name: 'Rp Two', categoryId, price: 20 })
  serviceId = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [providerId])).rows[0].id
  otherServiceId = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [otherProviderId])).rows[0].id
  const request = async (customer: string, provider: string) =>
    (await pool.query("INSERT INTO requests (customer_id, provider_id, description, answer_by, status) VALUES ($1, $2, 'x', now() + interval '3 days', 'quoted') RETURNING id", [customer, provider])).rows[0].id as string
  const quote = async (request: string, provider: string, amount: number) =>
    (await pool.query("INSERT INTO quotes (request_id, provider_id, amount, scope, expires_at) VALUES ($1, $2, $3, 'Zaun', now() + interval '7 days') RETURNING id", [request, provider, amount])).rows[0].id as string
  requestId = await request(ids.customer, providerId)
  quoteId = await quote(requestId, providerId, 100)
  otherCustomersQuoteId = await quote(await request(ids.other, providerId), providerId, 55)
  otherProvidersQuoteId = await quote(await request(ids.customer, otherProviderId), otherProviderId, 66)
  bookingId = (
    await pool.query("INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min) VALUES ($1, $2, $3, 'direct', 'proposed', now() + interval '5 days', 60) RETURNING id", [ids.customer, providerId, serviceId])
  ).rows[0].id
  await pool.query("INSERT INTO ledger_entries (booking_id, provider_id, kind, amount, idempotency_key) VALUES ($1, $2, 'charge', 10, 'rp-charge-1')", [bookingId, providerId])
  await pool.query("INSERT INTO stripe_events (id, type) VALUES ('evt_rp_1', 'checkout.session.completed') ON CONFLICT DO NOTHING")
})

afterAll(async () => {
  await pool.query("DELETE FROM stripe_events WHERE id = 'evt_rp_1'")
  await cleanupUsers()
})

const insertBooking = (o: { customer?: string; quote?: string | null; service?: string | null; provider?: string; status?: string; extra?: ReturnType<typeof sql> } = {}) =>
  sql`INSERT INTO bookings (customer_id, provider_id, quote_id, service_id, source, status, start_at, duration_min, on_site${o.extra ? sql`, ${o.extra}` : sql``})
    VALUES (${o.customer ?? ids.customer}, ${o.provider ?? providerId}, ${o.quote ?? null}, ${o.service === undefined ? serviceId : o.service}, ${o.quote ? 'quote' : 'direct'}, ${o.status ?? 'proposed'}, ${future}, 60, false${o.extra ? sql`, 1` : sql``})
    RETURNING amount, currency, request_id`

it('app_user cannot read ledger_entries or stripe_events', async () => {
  for (const uid of [ids.customer, ids.owner, null]) {
    for (const t of ['ledger_entries', 'stripe_events']) {
      await expect(run(uid, sql.raw(`SELECT * FROM ${t}`))).rejects.toMatchObject(denied)
      await expect(run(uid, sql.raw(`DELETE FROM ${t}`))).rejects.toMatchObject(denied)
    }
  }
  await expect(run(ids.owner, sql`INSERT INTO ledger_entries (booking_id, provider_id, kind, amount, idempotency_key) VALUES (${bookingId}, ${providerId}, 'transfer', 1, 'rp-forged')`)).rejects.toMatchObject(denied)
})

it('app_user cannot set amount or payment_ref on a booking', async () => {
  // on insert: not even the price, which comes from the quote or the service
  await expect(run(ids.customer, insertBooking({ extra: sql`amount` }))).rejects.toMatchObject(denied)
  for (const c of ['currency', 'commission_rate', 'paid_at', 'payment_ref', 'checkout_ref', 'released_at']) {
    await expect(run(ids.customer, sql.raw(`INSERT INTO bookings (customer_id, provider_id, service_id, source, start_at, duration_min, ${c}) VALUES ('${ids.customer}', '${providerId}', '${serviceId}', 'direct', now() + interval '3 days', 60, NULL)`))).rejects.toMatchObject(denied)
  }
  // on update, by either party
  for (const uid of [ids.customer, ids.owner]) {
    await expect(run(uid, sql`UPDATE bookings SET amount = 1 WHERE id = ${bookingId}`)).rejects.toMatchObject(denied)
    await expect(run(uid, sql`UPDATE bookings SET payment_ref = 'pi_x' WHERE id = ${bookingId}`)).rejects.toMatchObject(denied)
    await expect(run(uid, sql`UPDATE bookings SET commission_rate = 0 WHERE id = ${bookingId}`)).rejects.toMatchObject(denied)
    await expect(run(uid, sql`UPDATE providers SET stripe_account_id = 'acct_x'`)).rejects.toMatchObject(denied)
    await expect(run(uid, sql`UPDATE providers SET payouts_ready_at = now()`)).rejects.toMatchObject(denied)
  }
  // the owner connection (staff, the payment code) can
  await pool.query("UPDATE bookings SET payment_ref = 'pi_ok', commission_rate = 0.12 WHERE id = $1", [bookingId])
  await pool.query('UPDATE bookings SET payment_ref = NULL, commission_rate = NULL WHERE id = $1', [bookingId])
})

it('the app insert shape of bookings is exactly the columns app_user may write', () => {
  const all = Object.values(getTableColumns(bookings)).map((c) => c.name)
  const app = Object.values(getTableColumns(bookingAppInsert)).map((c) => c.name)
  for (const c of ['amount', 'currency', 'commission_rate', 'paid_at', 'payment_ref', 'checkout_ref', 'released_at']) expect(COLUMN_STAFF_ONLY.bookings).toContain(c) // plan 2d's ending columns: rls-endings
  expect(app.sort()).toEqual(all.filter((c) => !COLUMN_STAFF_ONLY.bookings!.includes(c)).sort())
})

it("a booking inserted without amount gets the quote's or the service's price", async () => {
  const fromQuote = (await run(ids.customer, insertBooking({ quote: quoteId }))).rows[0]
  expect(fromQuote).toEqual({ amount: '100.00', currency: 'EUR', request_id: requestId })
  const fromService = (await run(ids.customer, insertBooking())).rows[0]
  expect(fromService).toEqual({ amount: '10.00', currency: 'EUR', request_id: null })
  // the owner connection cannot supply its own price either when a quote or service is named
  const owner = await pool.query("INSERT INTO bookings (customer_id, provider_id, service_id, source, start_at, duration_min, amount) VALUES ($1, $2, $3, 'direct', now() + interval '3 days', 60, 999) RETURNING amount", [ids.customer, providerId, serviceId])
  expect(owner.rows[0].amount).toBe('10.00')
  // neither a quote nor a priced service: no amount, no booking
  await expect(run(ids.customer, insertBooking({ service: null }))).rejects.toThrow()
})

it('a booking with a forged quote or service id is refused', async () => {
  const forged = { cause: { message: expect.stringMatching(/does not belong/) } }
  await expect(run(ids.customer, insertBooking({ quote: otherCustomersQuoteId }))).rejects.toMatchObject(forged) // another customer's quote
  await expect(run(ids.customer, insertBooking({ quote: otherProvidersQuoteId }))).rejects.toMatchObject(forged) // another provider's quote
  await expect(run(ids.customer, insertBooking({ service: otherServiceId }))).rejects.toMatchObject(forged) // another provider's service
  await expect(run(ids.customer, insertBooking({ quote: quoteId, service: otherServiceId }))).rejects.toMatchObject(forged)
  // an app-supplied request_id is overwritten from the quote (none for a direct booking)
  const supplied = await run(ids.customer, sql`INSERT INTO bookings (customer_id, provider_id, service_id, request_id, source, start_at, duration_min) VALUES (${ids.customer}, ${providerId}, ${serviceId}, ${requestId}, 'direct', ${future}, 60) RETURNING request_id`)
  expect(supplied.rows).toEqual([{ request_id: null }])
})

it('quote_id, service_id and request_id are frozen after insert, even when repointed to valid ids of the same pair', async () => {
  // a second quote on the customer's own request and a second service of the same provider: valid for this pair
  const q2 = (await pool.query("INSERT INTO quotes (request_id, provider_id, version, amount, scope, expires_at) VALUES ($1, $2, 2, 5, 'billiger', now() + interval '7 days') RETURNING id", [requestId, providerId])).rows[0].id
  const s2 = (await pool.query("INSERT INTO services (provider_id, category_id, title, price_type, price) SELECT provider_id, category_id, 'Zweiter', 'fixed', 1 FROM services WHERE id = $1 RETURNING id", [serviceId])).rows[0].id
  const quoted = (await pool.query("INSERT INTO bookings (customer_id, provider_id, quote_id, service_id, source, start_at, duration_min) VALUES ($1, $2, $3, $4, 'quote', now() + interval '6 days', 60) RETURNING id", [ids.customer, providerId, quoteId, s2])).rows[0].id
  for (const uid of [ids.customer, ids.owner]) {
    await expect(run(uid, sql`UPDATE bookings SET quote_id = ${q2} WHERE id = ${quoted}`)).rejects.toMatchObject(unchangeable)
    await expect(run(uid, sql`UPDATE bookings SET service_id = ${serviceId} WHERE id = ${quoted}`)).rejects.toMatchObject(unchangeable)
    await expect(run(uid, sql`UPDATE bookings SET quote_id = ${otherCustomersQuoteId} WHERE id = ${bookingId}`)).rejects.toMatchObject(unchangeable)
    await expect(run(uid, sql`UPDATE bookings SET request_id = ${requestId} WHERE id = ${bookingId}`)).rejects.toMatchObject(unchangeable)
    expect((await run(uid, sql`UPDATE bookings SET quote_id = ${quoteId}, service_id = ${s2} WHERE id = ${quoted}`)).rowCount).toBe(1) // unchanged is fine
  }
  // ON DELETE SET NULL still works: removing the service clears the booking's service_id, the amount stays
  await pool.query('DELETE FROM services WHERE id = $1', [s2])
  expect((await pool.query('SELECT service_id, amount FROM bookings WHERE id = $1', [quoted])).rows).toEqual([{ service_id: null, amount: '100.00' }])
  await pool.query('DELETE FROM bookings WHERE id = $1', [quoted])
  await pool.query('DELETE FROM quotes WHERE id = $1', [q2])
})

it('app_user cannot set status confirmed; the owner connection can', async () => {
  expect(OWNER_ONLY_BOOKING_STATUSES).toContain('confirmed') // and the endings: rls-endings
  for (const uid of [ids.customer, ids.owner]) {
    await expect(run(uid, sql`UPDATE bookings SET status = 'confirmed' WHERE id = ${bookingId}`)).rejects.toMatchObject(paymentCodeOnly)
  }
  await expect(run(ids.customer, insertBooking({ status: 'confirmed' }))).rejects.toMatchObject(paymentCodeOnly)
  // other changes by the parties still work
  expect((await run(ids.customer, sql`UPDATE bookings SET note = 'Tor ist blau' WHERE id = ${bookingId}`)).rowCount).toBe(1)
  await pool.query("UPDATE bookings SET status = 'confirmed' WHERE id = $1", [bookingId])
  await expect(run(ids.customer, sql`UPDATE bookings SET note = 'Tor ist rot' WHERE id = ${bookingId}`)).rejects.toMatchObject(paymentCodeOnly) // a paid row is frozen for the parties (rls-endings)
  // a paid booking cannot be moved away by a party (that would dodge settlement); the owner connection can
  for (const uid of [ids.customer, ids.owner]) {
    for (const to of ['withdrawn', 'expired', 'declined', 'proposed']) {
      await expect(run(uid, sql`UPDATE bookings SET status = ${to} WHERE id = ${bookingId}`)).rejects.toMatchObject(paymentCodeOnly)
    }
  }
  expect((await run(ids.customer, sql`UPDATE bookings SET status = 'confirmed' WHERE id = ${bookingId}`)).rowCount).toBe(1) // unchanged is fine
  await pool.query("UPDATE bookings SET status = 'proposed' WHERE id = $1", [bookingId])
})

it('an awaiting-payment booking always has a pay-by date and an acceptance time', async () => {
  await expect(pool.query("UPDATE bookings SET status = 'awaiting-payment', pay_by = NULL, accepted_at = now() WHERE id = $1", [bookingId])).rejects.toThrow(/bookings_pay_by_check/)
  await expect(pool.query("UPDATE bookings SET status = 'awaiting-payment', pay_by = now() + interval '1 day', accepted_at = NULL WHERE id = $1", [bookingId])).rejects.toThrow(/bookings_accepted_at_check/)
  await pool.query("UPDATE bookings SET status = 'awaiting-payment', pay_by = now() + interval '1 day', accepted_at = now() WHERE id = $1", [bookingId])
  await pool.query("UPDATE bookings SET status = 'proposed', pay_by = NULL, accepted_at = NULL WHERE id = $1", [bookingId])
})

it("a quote's price, scope and dates cannot be changed once written; its status and reminder can", async () => {
  for (const uid of [ids.customer, ids.owner]) {
    for (const set of [sql`amount = 1`, sql`currency = 'USD'`, sql`scope = 'other'`, sql`start_at = now()`, sql`duration_min = 5`, sql`expires_at = now() + interval '30 days'`]) {
      await expect(run(uid, sql`UPDATE quotes SET ${set} WHERE id = ${quoteId}`)).rejects.toMatchObject(unchangeable)
    }
  }
  await expect(pool.query('UPDATE quotes SET amount = 1 WHERE id = $1', [quoteId])).rejects.toThrow(/cannot be changed/) // the owner connection too
  expect((await run(ids.customer, sql`UPDATE quotes SET status = 'declined', reminder_sent_at = now() WHERE id = ${quoteId}`)).rowCount).toBe(1)
  await pool.query("UPDATE quotes SET status = 'sent', reminder_sent_at = NULL WHERE id = $1", [quoteId])
})

it('updating or deleting a ledger row fails, even on the owner connection', async () => {
  await expect(pool.query("UPDATE ledger_entries SET amount = 1 WHERE idempotency_key = 'rp-charge-1'")).rejects.toThrow(/append-only/)
  await expect(pool.query("DELETE FROM ledger_entries WHERE idempotency_key = 'rp-charge-1'")).rejects.toThrow(/append-only/)
  await expect(pool.query("INSERT INTO ledger_entries (booking_id, provider_id, kind, amount, idempotency_key) VALUES ($1, $2, 'refund', 0, 'rp-zero')", [bookingId, providerId])).rejects.toThrow(/ledger_entries_amount_check/)
  await expect(pool.query("INSERT INTO ledger_entries (booking_id, provider_id, kind, amount, idempotency_key) VALUES ($1, $2, 'charge', 10, 'rp-charge-1')", [bookingId, providerId])).rejects.toThrow(/idempotency_key/)
  await expect(pool.query('TRUNCATE ledger_entries')).rejects.toThrow(/append-only/)
  expect((await pool.query("SELECT amount FROM ledger_entries WHERE idempotency_key = 'rp-charge-1'")).rows).toEqual([{ amount: '10.00' }])
})

it('a customer sees only their own watches', async () => {
  await pool.query('INSERT INTO availability_watches (customer_id, provider_id) VALUES ($1, $2), ($3, $2)', [ids.customer, providerId, ids.other])
  const mine = (uid: string | null) => asUser(uid, async (tx) => (await tx.execute(sql`SELECT customer_id FROM availability_watches`)).rows)
  expect(await mine(ids.customer)).toEqual([{ customer_id: ids.customer }])
  expect(await mine(ids.owner)).toEqual([]) // the provider gets a count from the domain, never the names
  expect(await mine(null)).toEqual([])
  await expect(run(ids.customer, sql`INSERT INTO availability_watches (customer_id, provider_id) VALUES (${ids.other}, ${otherProviderId})`)).rejects.toMatchObject(rls)
  expect((await run(ids.customer, sql`DELETE FROM availability_watches`)).rowCount).toBe(1)
  expect((await pool.query('SELECT customer_id FROM availability_watches WHERE provider_id = $1', [providerId])).rows).toEqual([{ customer_id: ids.other }])
})

it('cleanupUsers removes the test ledger rows (its own transaction-local switch), nothing else can', async () => {
  await cleanupUsers()
  expect((await pool.query("SELECT 1 FROM ledger_entries WHERE idempotency_key = 'rp-charge-1'")).rows).toHaveLength(0)
  expect((await pool.query("SELECT current_setting('kando.ledger_cleanup', true) AS s")).rows[0].s ?? '').not.toBe('on')
})
