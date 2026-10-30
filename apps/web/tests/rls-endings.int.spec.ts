import { afterAll, beforeAll, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { asUser, COLUMN_STAFF_ONLY, db, OWNER_ONLY_BOOKING_STATUSES, pool } from '@kando/db'
import { deleteAccount, MONEY_OPEN_STATUSES, slotIsHeld } from '@kando/domain'
import { cleanupUsers, EMAIL, seedBase, seedProvider, seedUser } from './helpers'

const U = { cust: 're-cust', other: 're-other', owner: 're-owner', owner2: 're-owner2', gone: 're-gone' }
let providerId: string
let otherProviderId: string
let serviceId: string
let rootId: string // a confirmed (paid) booking of cust with owner

const denied = { cause: { message: expect.stringContaining('permission denied') } }
// a status move is stopped first by app_status_guard (rls.ts APP_STATUS_MOVES), anything else by bookings_guard_status
const ownerOnly = { cause: { message: expect.stringMatching(/payment code only|not a move the app makes/) } }
const unchangeable = { cause: { message: expect.stringContaining('cannot be changed') } }
const foreignParent = { cause: { message: expect.stringMatching(/parent booking/) } }
const run = (uid: string | null, q: ReturnType<typeof sql>) => asUser(uid, (tx) => tx.execute(q))
const rows = async (uid: string | null, q: ReturnType<typeof sql>) => (await run(uid, q)).rows

/** A booking written on the owner connection (as the payment code and the endings leave it). */
async function booking(o: { status?: string; customer?: string; provider?: string; startHours?: number; extra?: Record<string, unknown> } = {}): Promise<string> {
  const p = o.provider ?? providerId
  const service = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [p])).rows[0].id
  const extra = Object.entries(o.extra ?? {})
  const cols = extra.map(([c]) => `, ${c}`).join('')
  const vals = extra.map((_, i) => `, $${i + 6}`).join('')
  return (
    await pool.query(
      `INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min${cols})
       VALUES ($1, $2, $3, 'direct', $4, now() + make_interval(hours => $5), 60${vals}) RETURNING id`,
      [o.customer ?? U.cust, p, service, o.status ?? 'confirmed', o.startHours ?? 72, ...extra.map(([, v]) => v)],
    )
  ).rows[0].id
}

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  for (const u of [U.cust, U.other, U.gone]) await seedUser(u)
  providerId = await seedProvider(U.owner, { name: 'Re Owner', categoryId, price: 100 })
  otherProviderId = await seedProvider(U.owner2, { name: 'Re Two', categoryId, price: 50 })
  serviceId = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [providerId])).rows[0].id
  rootId = await booking()
})
afterAll(cleanupUsers)

it('parties read their dispute; a third user does not; app_user cannot insert one', async () => {
  const id = (await pool.query("INSERT INTO disputes (booking_id, opened_by, reason, description, decide_by) VALUES ($1, 'customer', 'problem', 'Zaun schief', now() + interval '14 days') RETURNING id", [rootId])).rows[0].id
  for (const uid of [U.cust, U.owner]) expect(await rows(uid, sql`SELECT id, description FROM disputes`)).toEqual([{ id, description: 'Zaun schief' }])
  for (const uid of [U.other, U.owner2, null]) expect(await rows(uid, sql`SELECT id FROM disputes`)).toEqual([])
  for (const uid of [U.cust, U.owner]) {
    await expect(run(uid, sql`INSERT INTO disputes (booking_id, reason, description, decide_by) VALUES (${rootId}, 'problem', 'x', now())`)).rejects.toMatchObject(denied)
    await expect(run(uid, sql`UPDATE disputes SET decision = 'full-refund'`)).rejects.toMatchObject(denied)
    await expect(run(uid, sql`DELETE FROM disputes`)).rejects.toMatchObject(denied)
  }
  // one dispute per booking; the reason and decision are fixed lists; the system opens one without a person
  await expect(pool.query("INSERT INTO disputes (booking_id, reason, description, decide_by) VALUES ($1, 'no-response', '', now())", [rootId])).rejects.toThrow(/disputes_booking_id_unique/)
  const b2 = await booking()
  await expect(pool.query("INSERT INTO disputes (booking_id, reason, description, decide_by) VALUES ($1, 'other', '', now())", [b2])).rejects.toThrow(/disputes_reason_check/)
  await expect(pool.query("INSERT INTO disputes (booking_id, opened_by, reason, description, decide_by, decision, provider_share, decision_reason, decided_at) VALUES ($1, 'customer', 'problem', '', now(), 'half', 0, 'r', now())", [b2])).rejects.toThrow(/disputes_decision_check/)
  await expect(pool.query("INSERT INTO disputes (booking_id, opened_by, reason, description, decide_by) VALUES ($1, 'staff', 'problem', '', now())", [b2])).rejects.toThrow(/disputes_opened_by_check/)
  await pool.query("INSERT INTO disputes (booking_id, reason, description, decide_by) VALUES ($1, 'no-response', '', now())", [b2])
})

it('a hidden review and a not-yet-visible review are invisible to others but visible to the author', async () => {
  const b = await booking({ status: 'completed' })
  const review = (author: string, subject: string, role: string, visible: string | null, hidden = false) =>
    pool.query(`INSERT INTO reviews (booking_id, author_id, subject_id, author_role, stars, text, hidden, visible_at) VALUES ($1, $2, $3, $4, 4, 'gut', $5, ${visible ?? 'NULL'}) RETURNING id`, [b, author, subject, role, hidden])
  const fromCustomer = (await review(U.cust, U.owner, 'customer', null)).rows[0].id // not visible yet
  const fromProvider = (await review(U.owner, U.cust, 'provider', "now() + interval '1 day'")).rows[0].id // visible tomorrow
  const seen = async (uid: string | null) => (await rows(uid, sql`SELECT id FROM reviews WHERE booking_id = ${b}`)).map((r) => r.id).sort()
  expect(await seen(U.cust)).toEqual([fromCustomer])
  expect(await seen(U.owner)).toEqual([fromProvider])
  for (const uid of [U.other, null]) expect(await seen(uid)).toEqual([])
  // both visible: everyone sees both
  await pool.query("UPDATE reviews SET visible_at = now() - interval '1 minute' WHERE booking_id = $1", [b])
  for (const uid of [U.cust, U.owner, U.other, null]) expect(await seen(uid)).toEqual([fromCustomer, fromProvider].sort())
  // hidden by staff: gone for everyone but its author
  await pool.query("UPDATE reviews SET hidden = true, hidden_reason = 'Beleidigung' WHERE id = $1", [fromCustomer])
  expect(await seen(U.cust)).toEqual([fromCustomer, fromProvider].sort())
  for (const uid of [U.owner, U.other, null]) expect(await seen(uid)).toEqual([fromProvider])
  // written only on the owner connection
  for (const uid of [U.cust, U.owner]) {
    await expect(run(uid, sql`INSERT INTO reviews (booking_id, author_id, subject_id, author_role, stars) VALUES (${b}, ${uid}, ${U.other}, 'customer', 5)`)).rejects.toMatchObject(denied)
    await expect(run(uid, sql`UPDATE reviews SET stars = 5`)).rejects.toMatchObject(denied)
    await expect(run(uid, sql`DELETE FROM reviews`)).rejects.toMatchObject(denied)
  }
})

it('one review per author and booking; stars 1 to 5; the author role is customer or provider', async () => {
  const b = await booking({ status: 'completed' })
  const add = (author: string, stars: number, role = 'customer') =>
    pool.query('INSERT INTO reviews (booking_id, author_id, subject_id, author_role, stars) VALUES ($1, $2, $3, $4, $5)', [b, author, U.owner, role, stars])
  await expect(add(U.cust, 0)).rejects.toThrow(/reviews_stars_check/)
  await expect(add(U.cust, 6)).rejects.toThrow(/reviews_stars_check/)
  await expect(add(U.cust, 3, 'staff')).rejects.toThrow(/reviews_author_role_check/)
  await add(U.cust, 5)
  await expect(add(U.cust, 4)).rejects.toThrow(/reviews_booking_id_author_id_idx/)
})

it('app_user cannot set completed, cancelled or refunded', async () => {
  expect([...OWNER_ONLY_BOOKING_STATUSES].sort()).toEqual(['cancelled', 'completed', 'confirmed', 'disputed', 'finished', 'refunded', 'stopped'])
  const ending = ['finished', 'completed', 'disputed', 'cancelled', 'stopped', 'refunded']
  const proposed = await booking({ status: 'proposed' })
  for (const to of ending) {
    // not on insert, not by moving a booking in, by either party
    await expect(run(U.cust, sql`INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min) VALUES (${U.cust}, ${providerId}, ${serviceId}, 'direct', ${to}, now() + interval '3 days', 60)`)).rejects.toMatchObject(ownerOnly)
    for (const uid of [U.cust, U.owner]) {
      await expect(run(uid, sql`UPDATE bookings SET status = ${to} WHERE id = ${proposed}`)).rejects.toMatchObject(ownerOnly)
      await expect(run(uid, sql`UPDATE bookings SET status = ${to} WHERE id = ${rootId}`)).rejects.toMatchObject(ownerOnly)
    }
    // and not out of it either; the owner connection can do both
    const ended = await booking({ status: to })
    for (const uid of [U.cust, U.owner]) {
      for (const away of ['withdrawn', 'confirmed', 'proposed', ending.find((s) => s !== to)!]) {
        await expect(run(uid, sql`UPDATE bookings SET status = ${away} WHERE id = ${ended}`)).rejects.toMatchObject(ownerOnly)
      }
    }
    await pool.query("UPDATE bookings SET status = 'confirmed' WHERE id = $1", [ended])
  }
  // the app transitions still work: proposed -> awaiting-payment -> withdrawn, proposed -> declined
  expect((await run(U.owner, sql`UPDATE bookings SET status = 'awaiting-payment', pay_by = now() + interval '1 day', accepted_at = now() WHERE id = ${proposed}`)).rowCount).toBe(1)
  expect((await run(U.cust, sql`UPDATE bookings SET status = 'withdrawn' WHERE id = ${proposed}`)).rowCount).toBe(1)
  const another = await booking({ status: 'proposed' })
  expect((await run(U.owner, sql`UPDATE bookings SET status = 'declined' WHERE id = ${another}`)).rowCount).toBe(1)
})

const NEW_COLUMNS: [string, string][] = [
  ['parent_booking_id', `'${'00000000-0000-0000-0000-000000000000'}'`],
  ['finished_at', 'now()'],
  ['confirm_by', 'now()'],
  ['confirm_reminders_sent', '1'],
  ['asked_done_at', 'now()'],
  ['completed_at', 'now()'],
  ['cancelled_at', 'now()'],
  ['cancelled_by', "'customer'"],
  ['late_cancel', 'true'],
  ['no_show', "'provider'"],
  ['no_show_reported_at', 'now()'],
  ['stopped_at', 'now()'],
  ['stopped_by', "'customer'"],
  ['stop_amount', '1'],
  ['stop_note', "'x'"],
  ['stop_stated_at', 'now()'],
  ['material_amount', '1'],
]

it('the new booking columns cannot be set by app_user on insert or update', async () => {
  for (const [c] of NEW_COLUMNS) expect(COLUMN_STAFF_ONLY.bookings, c).toContain(c)
  for (const [c, v] of NEW_COLUMNS) {
    await expect(run(U.cust, sql.raw(`INSERT INTO bookings (customer_id, provider_id, service_id, source, start_at, duration_min, ${c}) VALUES ('${U.cust}', '${providerId}', '${serviceId}', 'direct', now() + interval '3 days', 60, ${v})`))).rejects.toMatchObject(denied)
    for (const uid of [U.cust, U.owner]) await expect(run(uid, sql.raw(`UPDATE bookings SET ${c} = ${v} WHERE id = '${rootId}'`))).rejects.toMatchObject(denied)
  }
  // safe defaults for rows written without them
  expect((await pool.query('SELECT confirm_reminders_sent, late_cancel, material_amount, parent_booking_id FROM bookings WHERE id = $1', [rootId])).rows).toEqual([{ confirm_reminders_sent: 0, late_cancel: false, material_amount: '0.00', parent_booking_id: null }])
  // the who-columns are fixed lists
  await expect(pool.query("UPDATE bookings SET cancelled_by = 'staff' WHERE id = $1", [rootId])).rejects.toThrow(/bookings_cancelled_by_check/)
  await expect(pool.query("UPDATE bookings SET no_show = 'both' WHERE id = $1", [rootId])).rejects.toThrow(/bookings_no_show_check/)
  await expect(pool.query("UPDATE bookings SET stopped_by = 'staff' WHERE id = $1", [rootId])).rejects.toThrow(/bookings_stopped_by_check/)
})

it('parentBookingId: a forged parent, another pair, an unpaid or nested parent is refused; it never changes after insert', async () => {
  const theirs = await booking({ customer: U.other }) // another customer's paid booking with the same provider
  const elsewhere = await booking({ provider: otherProviderId }) // the customer's paid booking with another provider
  const unpaid = await booking({ status: 'awaiting-payment', extra: { pay_by: new Date(Date.now() + 86_400_000), accepted_at: new Date() } })
  const cancelled = await booking({ status: 'cancelled' })
  const request = (parent: string | null) =>
    run(U.cust, sql`INSERT INTO requests (customer_id, provider_id, service_id, description, answer_by, parent_booking_id) VALUES (${U.cust}, ${providerId}, ${serviceId}, 'Noch ein Tor', now() + interval '3 days', ${parent}) RETURNING id`)
  // the customer's additional-task request: only on their own paid booking with this provider
  for (const bad of [theirs, elsewhere, unpaid, cancelled]) await expect(request(bad)).rejects.toMatchObject(foreignParent)
  const req = (await request(rootId)).rows[0]!.id as string
  // the child booking (owner connection only: app_user cannot even name the column) from a quote on that request
  const quote = (await pool.query("INSERT INTO quotes (request_id, provider_id, amount, scope, expires_at, status) VALUES ($1, $2, 30, 'Tor', now() + interval '7 days', 'accepted') RETURNING id", [req, providerId])).rows[0].id
  const child = (o: { parent: string | null; customer?: string }) =>
    pool.query(
      "INSERT INTO bookings (customer_id, provider_id, quote_id, source, status, start_at, duration_min, parent_booking_id, pay_by, accepted_at) VALUES ($1, $2, $3, 'quote', 'awaiting-payment', now() + interval '3 days', 60, $4, now() + interval '2 days', now()) RETURNING id, amount, request_id",
      [o.customer ?? U.cust, providerId, quote, o.parent],
    )
  await expect(child({ parent: null })).rejects.toThrow(/parent booking/) // a quote of an additional-task request makes an additional task
  await expect(child({ parent: theirs })).rejects.toThrow(/parent booking/)
  await expect(child({ parent: elsewhere })).rejects.toThrow(/parent booking/)
  const made = (await child({ parent: rootId })).rows[0]
  expect(made).toMatchObject({ amount: '30.00', request_id: req }) // the price still comes from the quote
  await pool.query("UPDATE bookings SET status = 'confirmed' WHERE id = $1", [made.id])
  await expect(pool.query("INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, parent_booking_id) VALUES ($1, $2, $3, 'direct', 'confirmed', now() + interval '3 days', 60, $4)", [U.cust, providerId, serviceId, made.id])).rejects.toThrow(/parent booking/) // no additional task of an additional task
  await expect(run(U.cust, sql`INSERT INTO requests (customer_id, provider_id, description, answer_by, parent_booking_id) VALUES (${U.cust}, ${providerId}, 'x', now() + interval '3 days', ${made.id})`)).rejects.toMatchObject(foreignParent)
  // a forged id: no such booking
  await expect(request('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject(foreignParent)
  // never changed after insert, by anyone
  await expect(pool.query('UPDATE bookings SET parent_booking_id = $1 WHERE id = $2', [elsewhere, made.id])).rejects.toThrow(/cannot be changed/)
  await expect(pool.query('UPDATE bookings SET parent_booking_id = NULL WHERE id = $1', [made.id])).rejects.toThrow(/cannot be changed/)
  await expect(pool.query('UPDATE bookings SET parent_booking_id = $1 WHERE id = $2', [rootId, theirs])).rejects.toThrow(/cannot be changed/)
  await expect(run(U.cust, sql`UPDATE requests SET parent_booking_id = NULL WHERE id = ${req}`)).rejects.toMatchObject(unchangeable)
  await expect(pool.query('UPDATE requests SET parent_booking_id = $1 WHERE id = $2', [elsewhere, req])).rejects.toThrow(/cannot be changed/)
})

it('provider_reliability returns a count only', async () => {
  const months = (n: number) => new Date(Date.now() - n * 30 * 86_400_000)
  await booking({ status: 'cancelled', extra: { cancelled_by: 'provider', late_cancel: true, cancelled_at: months(1) } }) // counts
  await booking({ status: 'cancelled', extra: { no_show: 'provider', no_show_reported_at: months(2) } }) // counts
  await booking({ status: 'refunded', extra: { no_show: 'provider', no_show_reported_at: months(3) } }) // a no-show upheld by staff: counts
  await booking({ status: 'cancelled', extra: { cancelled_by: 'provider', late_cancel: true, cancelled_at: months(13) } }) // older than 12 months
  await booking({ status: 'cancelled', extra: { cancelled_by: 'provider', late_cancel: false, cancelled_at: months(1) } }) // in time
  await booking({ status: 'cancelled', extra: { cancelled_by: 'customer', late_cancel: true, cancelled_at: months(1) } }) // the customer's
  await booking({ status: 'cancelled', extra: { no_show: 'customer', no_show_reported_at: months(1) } }) // the customer's
  await booking({ status: 'disputed', extra: { no_show: 'provider', no_show_reported_at: months(1) } }) // objected, not decided
  await booking({ provider: otherProviderId, status: 'cancelled', extra: { cancelled_by: 'provider', late_cancel: true, cancelled_at: months(1) } })
  const reliability = async (uid: string | null, p: string) => (await rows(uid, sql`SELECT * FROM provider_reliability(${p}::uuid)`))
  for (const uid of [null, U.other, U.owner]) expect(await reliability(uid, providerId)).toEqual([{ provider_reliability: 3 }])
  expect(await reliability(null, otherProviderId)).toEqual([{ provider_reliability: 1 }])
  // only for a provider the public may see (or the caller's own)
  await pool.query("UPDATE providers SET status = 'draft' WHERE id = $1", [providerId])
  expect(await reliability(null, providerId)).toEqual([{ provider_reliability: 0 }])
  expect(await reliability(U.owner, providerId)).toEqual([{ provider_reliability: 3 }])
  await pool.query("UPDATE providers SET status = 'published' WHERE id = $1", [providerId])
  const { rows: fn } = await pool.query("SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'provider_reliability'")
  expect(fn).toEqual([{ prosecdef: true, proconfig: ['search_path=public, pg_temp'] }])
})

it('worked bookings keep their time; cancelled and refunded ones free it', async () => {
  const start = new Date(Date.now() + 400 * 86_400_000)
  const at = (status: string) => booking({ status, startHours: 400 * 24 + 1 })
  const held = () => slotIsHeld(db, providerId, new Date(start.getTime() + 3_600_000), 60, false, new Date())
  const busy = async () => (await rows(null, sql`SELECT state FROM busy_times(${providerId}::uuid, ${start.toISOString()}::timestamptz, ${new Date(start.getTime() + 2 * 86_400_000).toISOString()}::timestamptz)`)).map((r) => r.state)
  for (const status of ['cancelled', 'refunded']) {
    const id = await at(status)
    expect([await held(), await busy()], status).toEqual([false, []])
    await pool.query('DELETE FROM bookings WHERE id = $1', [id])
  }
  for (const status of ['finished', 'disputed', 'stopped', 'completed']) {
    const id = await at(status)
    expect([await held(), await busy()], status).toEqual([true, ['booked']])
    await pool.query('DELETE FROM bookings WHERE id = $1', [id])
  }
})

it('deleting an account with a finished, disputed or stopped booking is 409; reviews and disputes go with the person', async () => {
  expect([...MONEY_OPEN_STATUSES].sort()).toEqual(['confirmed', 'disputed', 'finished', 'stopped'])
  const refusal = (p: Promise<unknown>) => p.then(() => null, async (e: unknown) => (e instanceof Response ? { status: e.status, body: await e.json() } : e))
  for (const status of ['finished', 'disputed', 'stopped']) {
    const id = await booking({ customer: U.gone, status })
    expect(await refusal(deleteAccount(U.gone, () => {})), status).toEqual({ status: 409, body: { error: 'OPEN_BOOKINGS' } })
    await pool.query("UPDATE bookings SET status = 'completed' WHERE id = $1", [id])
  }
  const done = await booking({ customer: U.gone, status: 'completed' })
  await pool.query("INSERT INTO disputes (booking_id, opened_by, reason, description, decide_by, decision, provider_share, decision_reason, decided_by, decided_at) VALUES ($1, 'customer', 'problem', 'x', now(), 'full-payout', 100, 'erledigt', 'staff-1', now())", [done])
  // an additional task of it (child booking from its request and quote): goes too
  const childRequest = (await pool.query("INSERT INTO requests (customer_id, provider_id, description, answer_by, parent_booking_id) VALUES ($1, $2, 'Zusatz', now(), $3) RETURNING id", [U.gone, providerId, done])).rows[0].id
  const childQuote = (await pool.query("INSERT INTO quotes (request_id, provider_id, amount, scope, expires_at, status) VALUES ($1, $2, 20, 'Zusatz', now() + interval '7 days', 'accepted') RETURNING id", [childRequest, providerId])).rows[0].id
  await pool.query("INSERT INTO bookings (customer_id, provider_id, quote_id, source, status, start_at, duration_min, parent_booking_id) VALUES ($1, $2, $3, 'quote', 'completed', now() + interval '3 days', 60, $4)", [U.gone, providerId, childQuote, done])
  await pool.query("INSERT INTO reviews (booking_id, author_id, subject_id, author_role, stars) VALUES ($1, $2, $3, 'customer', 2), ($1, $3, $2, 'provider', 5)", [done, U.gone, U.owner])
  await pool.query("INSERT INTO requests (customer_id, provider_id, description, answer_by, parent_booking_id) VALUES ($1, $2, 'Noch ein Tor', now(), $3)", [U.gone, providerId, done]) // an additional task's request
  await deleteAccount(U.gone, () => {})
  expect((await pool.query('SELECT count(*)::int n FROM requests WHERE parent_booking_id = $1', [done])).rows[0].n).toBe(0)
  expect((await pool.query('SELECT count(*)::int n FROM disputes WHERE booking_id = $1', [done])).rows[0].n).toBe(0)
  expect((await pool.query('SELECT count(*)::int n FROM reviews WHERE booking_id = $1', [done])).rows[0].n).toBe(0)
  expect((await pool.query('SELECT count(*)::int n FROM users WHERE id = $1', [U.gone])).rows[0].n).toBe(0)
})

it('a dispute decision is complete and consistent; a person-opened reason names the side', async () => {
  const b = await booking({ status: 'disputed' })
  const add = (cols: string, vals: string) => pool.query(`INSERT INTO disputes (booking_id, reason, description, decide_by, ${cols}) VALUES ($1, ${vals})`, [b])
  const open = "'problem', 'x', now(), 'customer'"
  await expect(add('opened_by', "'problem', 'x', now(), NULL")).rejects.toThrow(/disputes_opened_by_needed_check/)
  await expect(add('opened_by', "'no-show-objection', 'x', now(), NULL")).rejects.toThrow(/disputes_opened_by_needed_check/)
  await expect(add('opened_by, decision', `${open}, 'full-payout'`)).rejects.toThrow(/disputes_decided_check/) // no date, share or reason
  await expect(add('opened_by, decision, decided_at, decision_reason', `${open}, 'partial', now(), 'r'`)).rejects.toThrow(/disputes_decided_check/) // no share
  await expect(add('opened_by, decided_at', `${open}, now()`)).rejects.toThrow(/disputes_decided_check/) // a date without a decision
  await expect(add('opened_by, decision, decided_at, decision_reason, provider_share', `${open}, 'partial', now(), 'r', -1`)).rejects.toThrow(/disputes_provider_share_check/)
  await expect(add('opened_by, decision, decided_at, decision_reason, provider_share', `${open}, 'full-refund', now(), 'r', 5`)).rejects.toThrow(/disputes_provider_share_check/)
  await add('opened_by, decision, decided_at, decision_reason, provider_share', `${open}, 'partial', now(), 'r', 30`)
})

it('app_user cannot delete a booking in any status; account deletion on the owner connection still can', async () => {
  for (const status of ['proposed', 'withdrawn', ...OWNER_ONLY_BOOKING_STATUSES]) {
    const id = await booking({ status })
    for (const uid of [U.cust, U.owner]) await expect(run(uid, sql`DELETE FROM bookings WHERE id = ${id}`)).rejects.toMatchObject(denied)
  }
})

it('app_user cannot change any column of an owner-only booking; a proposed booking stays writable', async () => {
  for (const status of OWNER_ONLY_BOOKING_STATUSES) {
    const id = await booking({ status })
    for (const uid of [U.cust, U.owner]) {
      for (const set of [sql`start_at = now() + interval '30 days'`, sql`duration_min = 600`, sql`pay_by = now()`, sql`address_street = 'Neu 1'`, sql`address_postcode = '10115'`, sql`note = 'x'`, sql`on_site = false`, sql`updated_at = now()`]) {
        await expect(run(uid, sql`UPDATE bookings SET ${set} WHERE id = ${id}`), status).rejects.toMatchObject(ownerOnly)
      }
      expect((await run(uid, sql`UPDATE bookings SET status = status, note = note WHERE id = ${id}`)).rowCount).toBe(1) // nothing changed: fine
    }
    expect((await pool.query("UPDATE bookings SET note = 'Staff' WHERE id = $1", [id])).rowCount).toBe(1) // the owner connection can
  }
  const proposed = await booking({ status: 'proposed' })
  expect((await run(U.owner, sql`UPDATE bookings SET start_at = now() + interval '4 days', duration_min = 90, counter_by = 'provider', answer_by = now() + interval '1 day' WHERE id = ${proposed}`)).rowCount).toBe(1)
  expect((await run(U.cust, sql`UPDATE bookings SET note = 'Tor', address_street = 'Hauptstr. 2' WHERE id = ${proposed}`)).rowCount).toBe(1)
})
