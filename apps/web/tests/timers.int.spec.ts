import { afterAll, beforeAll, expect, it } from 'vitest'
import { asUser, db, pool } from '@kando/db'
import { acceptQuote, clearOutbox, createRequest, drainOutbox, getBooking, getRequest, listBookings, listQuotes, listRequests, outboxForTests, runDueTimers, runExpiryAndReminders, sendQuote, withdrawRequest } from '@kando/domain'
import { cleanupUsers, EMAIL, seedBase, seedProvider, seedUser } from './helpers'

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
      "INSERT INTO bookings (customer_id, provider_id, service_id, source, status, start_at, duration_min, answer_by, pay_by, accepted_at) VALUES ($1, $2, $3, 'direct', $4, $5, 60, $6, $7, COALESCE($8::timestamptz, CASE WHEN $4::text = 'awaiting-payment' THEN $7::timestamptz - interval '48 hours' END)) RETURNING id",
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
  expect(await run(0)).toEqual({ requestsExpired: 0, quotesExpired: 0, proposalsLapsed: 0, unpaidExpired: 0, remindersSent: 0, ignoredNotices: 0, customersWaiting: 0, confirmReminders: 0, autoReleased: 0, askedDone: 0, sentToStaff: 0, noShowsResolved: 0, cancelsSettled: 0, stopsToStaff: 0, overdueDisputes: 0, ignoredNoticeFlags: 0, reviewsShown: 0, decisionsApplied: 0, invoicesIssued: 0, commissionInvoices: 0 }) // the first run took everything due
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
  await pool.query('UPDATE bookings SET updated_at = $1 WHERE id = $2', [at(30), b]) // a later write to the row: the reminders still count from accepted_at
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
  await runDueTimers(db, new Date())
  expect(await status('bookings', b)).toBe('awaiting-payment') // PAY_GRACE_MINUTES: a payment made at the deadline may still arrive
  await pool.query("UPDATE bookings SET pay_by = now() - interval '11 minutes' WHERE id = $1", [b])
  await runDueTimers(db, new Date())
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

it('a lapsed request reads expired in the list and alone, the row is untouched, and a new request to the provider is accepted', async () => {
  await clean()
  const past = () => new Date(Date.now() - 60_000).toISOString()
  const mine = await request(prov, past())
  const b = await booking('proposed', { answerBy: past() })
  const b2 = await booking('awaiting-payment', { payBy: new Date(Date.now() - 11 * 60_000).toISOString() }) // after PAY_GRACE_MINUTES
  expect((await asUser(U.cust, (tx) => listRequests(tx, U.cust, 'customer'))).docs.find((r) => r.id === mine)?.status).toBe('expired')
  expect((await asUser(U.owner, (tx) => listRequests(tx, U.owner, 'provider'))).docs.find((r) => r.id === mine)?.status).toBe('expired')
  expect((await asUser(U.cust, (tx) => getRequest(tx, U.cust, mine))).status).toBe('expired')
  expect((await asUser(U.cust, (tx) => listBookings(tx, U.cust, 'customer'))).docs.find((x) => x.id === b)?.status).toBe('expired')
  expect((await asUser(U.owner, (tx) => listBookings(tx, U.owner, 'provider'))).docs.find((x) => x.id === b2)?.status).toBe('expired')
  expect((await asUser(U.cust, (tx) => getBooking(tx, U.cust, b))).booking.status).toBe('expired')
  expect([await status('requests', mine), await status('bookings', b), await status('bookings', b2)]).toEqual(['open', 'proposed', 'awaiting-payment']) // shown, not written
  expect(await notes('request-expired')).toHaveLength(0)
  const again = await asUser(U.cust, (tx) => createRequest(tx, U.cust, { providerId: prov, description: 'second try' }))
  expect(again.status).toBe('open')
})

it('a list read writes nothing', async () => {
  await clean()
  await booking('awaiting-payment', { acceptedAt: new Date(Date.now() - 20 * 3_600_000).toISOString(), payBy: new Date(Date.now() + 3_600_000).toISOString() }) // a reminder is due
  await booking('proposed', { answerBy: new Date(Date.now() - 60_000).toISOString() })
  for (let i = 0; i < 3; i++) await request(prov, new Date(Date.now() - 60_000 * (i + 1)).toISOString())
  const snapshot = async () => (await pool.query("SELECT (SELECT json_agg(r ORDER BY id) FROM requests r WHERE customer_id LIKE 'tm-%') r, (SELECT json_agg(b ORDER BY id) FROM bookings b WHERE customer_id LIKE 'tm-%') b, (SELECT count(*) FROM notifications WHERE user_id LIKE 'tm-%') n")).rows[0]
  const before = await snapshot()
  clearOutbox()
  await asUser(U.cust, (tx) => listBookings(tx, U.cust, 'customer'))
  await asUser(U.owner, (tx) => listBookings(tx, U.owner, 'provider'))
  await asUser(U.cust, (tx) => listRequests(tx, U.cust, 'customer'))
  await asUser(U.owner, (tx) => listRequests(tx, U.owner, 'provider'))
  expect(await snapshot()).toEqual(before)
  expect(outboxForTests()).toEqual([])
})

const unmailed = async () => (await pool.query("SELECT payload FROM notifications WHERE user_id LIKE 'tm-%' AND mailed_at IS NULL")).rows
const mailsTo = (id: string) => outboxForTests().filter((m) => m.to === EMAIL(id))

it('outbox: a run that stops halfway leaves the rest for the next run', async () => {
  await clean()
  for (let i = 0; i < 3; i++) await booking('awaiting-payment', { acceptedAt: at(-10), payBy: at(2) }) // the last reminder is due
  await runExpiryAndReminders(db, new Date(NOW), { budgetMs: 0 }) // the rules always run; no time left to send
  expect(await notes('payment-reminder')).toHaveLength(3)
  expect(await unmailed()).toHaveLength(3)
  clearOutbox()
  expect(await drainOutbox(db, new Date(NOW), { timeUp: () => outboxForTests().length >= 1 })).toBe(1)
  expect(mailsTo(U.cust)).toHaveLength(1)
  expect(await unmailed()).toHaveLength(2)
  expect(await drainOutbox(db, new Date(NOW))).toBe(2)
  expect(mailsTo(U.cust)).toHaveLength(3)
  expect(await unmailed()).toHaveLength(0)
})

it('a notice older than 48 hours is not emailed', async () => {
  await clean()
  const b = await booking('awaiting-payment', { acceptedAt: at(-10), payBy: at(2) })
  const row = (hours: number) => pool.query("INSERT INTO notifications (user_id, kind, payload, created_at, mailed_at) VALUES ($1, 'payment-reminder', $2, $3, NULL)", [U.cust, { bookingId: b }, at(-hours)])
  await row(49)
  await row(47)
  clearOutbox()
  expect(await drainOutbox(db, new Date(NOW))).toBe(1)
  expect(mailsTo(U.cust)).toHaveLength(1)
  expect(await unmailed()).toHaveLength(1) // the late one stays unsent
  await clean()
})

it('outbox: a reminder whose deadline has passed or whose item is closed is claimed but not emailed', async () => {
  await clean()
  const live = await booking('awaiting-payment', { acceptedAt: at(-10), payBy: at(2) })
  const late = await booking('awaiting-payment', { acceptedAt: at(-10), payBy: at(-1) }) // not expired yet (grace), deadline passed
  const r = await request(prov, at(24 * 5), 'quoted')
  const quote = async (version: number, st: string) =>
    (await pool.query("INSERT INTO quotes (request_id, provider_id, amount, scope, expires_at, status, version) VALUES ($1, $2, 50, 's', $3, $4, $5) RETURNING id", [r, prov, at(20), st, version])).rows[0].id as string
  const qSuperseded = await quote(1, 'superseded')
  const qLive = await quote(2, 'sent')
  const row = (kind: string, payload: object) => pool.query('INSERT INTO notifications (user_id, kind, payload, created_at, mailed_at) VALUES ($1, $2, $3, $4, NULL)', [U.cust, kind, payload, at(-3)])
  await row('payment-reminder', { bookingId: live })
  await row('payment-reminder', { bookingId: late })
  await row('quote-expiring', { quoteId: qLive, requestId: r })
  await row('quote-expiring', { quoteId: qSuperseded, requestId: r })
  clearOutbox()
  expect(await drainOutbox(db, new Date(NOW))).toBe(2)
  expect(mailsTo(U.cust)).toHaveLength(2)
  expect(await unmailed()).toHaveLength(0) // the stale ones are claimed too: never retried
  await pool.query('DELETE FROM quotes WHERE request_id = $1', [r])
  await clean()
})

// A quote-born booking that ends unagreed reopens its request and quote (trigger bookings_reopen_request, rls.ts)
const quoteBorn = async (status: 'proposed' | 'awaiting-payment', quoteExpiresAt: string, parent: string | null = null) => {
  const r = (await pool.query("INSERT INTO requests (customer_id, provider_id, description, status, answer_by, parent_booking_id) VALUES ($1, $2, 'x', 'booked', $3, $4) RETURNING id", [U.cust, prov, at(-48), parent])).rows[0].id as string
  const q = (await pool.query("INSERT INTO quotes (request_id, provider_id, amount, scope, expires_at, status) VALUES ($1, $2, 50, 's', $3, 'accepted') RETURNING id", [r, prov, quoteExpiresAt])).rows[0].id as string
  const due = status === 'proposed' ? [at(-1), null, null] : [null, at(-1), at(-49)]
  const b = (
    await pool.query(
      "INSERT INTO bookings (customer_id, provider_id, quote_id, source, status, start_at, duration_min, answer_by, pay_by, accepted_at, parent_booking_id) VALUES ($1, $2, $3, 'quote', $4, $5, 60, $6, $7, $8, $9) RETURNING id",
      [U.cust, prov, q, status, at(24 * 20), ...due, parent],
    )
  ).rows[0].id as string
  return { r, q, b }
}
const kinds = async (b: string) => (await pool.query("SELECT user_id, kind, payload FROM notifications WHERE payload->>'bookingId' = $1 ORDER BY user_id", [b])).rows

it('a lapsed proposal and an unpaid expiry reopen the request (timer) and send request-reopened through the outbox', async () => {
  await clean()
  const lapsed = await quoteBorn('proposed', at(24 * 3))
  const unpaid = await quoteBorn('awaiting-payment', at(24 * 3))
  clearOutbox()
  await run(0)
  for (const x of [lapsed, unpaid]) {
    expect([await status('bookings', x.b), await status('requests', x.r), await status('quotes', x.q)]).toEqual(['expired', 'quoted', 'sent'])
  }
  expect(await kinds(lapsed.b)).toEqual([{ user_id: U.cust, kind: 'request-reopened', payload: { requestId: lapsed.r, bookingId: lapsed.b } }])
  expect(await kinds(unpaid.b)).toEqual([
    { user_id: U.cust, kind: 'request-reopened', payload: { requestId: unpaid.r, bookingId: unpaid.b } },
    { user_id: U.owner, kind: 'booking-expired', payload: { bookingId: unpaid.b } }, // the provider keeps booking-expired
  ])
  expect(await unmailed()).toHaveLength(0)
  const reopened = mailsTo(U.cust)
  expect(reopened).toHaveLength(2)
  for (const m of reopened) expect(m.text).toMatch(/13[./]03[./]2027/) // the quote's expiry (NOW + 3 days)
})

it("reopen at the quote's expiry keeps the quote expired", async () => {
  await clean()
  const x = await quoteBorn('proposed', at(0)) // the quote expires in the very second the proposal lapses
  await run(0)
  expect([await status('bookings', x.b), await status('requests', x.r), await status('quotes', x.q)]).toEqual(['expired', 'quoted', 'expired'])
  expect((await kinds(x.b)).map((n) => n.kind)).toEqual(['booking-expired']) // nothing to reopen: the customer hears the booking expired
  const res = await asUser(U.cust, (tx) => acceptQuote(tx, U.cust, x.q, { startAt: at(24 * 30), durationMin: 60, onSite: true, address: { postcode: '10115' } }, new Date(NOW))).catch((e: Response) => e)
  expect(res).toBeInstanceOf(Response)
  expect([(res as Response).status, await (res as Response).json()]).toEqual([409, { error: 'quote-expired' }])
})

it('a direct booking and an additional task change no request', async () => {
  await clean()
  const d = await booking('proposed', { answerBy: at(-1) })
  const parent = await booking('confirmed')
  await pool.query('UPDATE bookings SET paid_at = $1 WHERE id = $2', [at(-24), parent])
  const kid = await quoteBorn('awaiting-payment', at(24 * 3), parent)
  const requestsBefore = (await pool.query('SELECT id, status, updated_at FROM requests WHERE customer_id = $1 ORDER BY id', [U.cust])).rows
  await run(0)
  expect([await status('bookings', d), await status('bookings', kid.b)]).toEqual(['expired', 'expired'])
  expect([await status('requests', kid.r), await status('quotes', kid.q)]).toEqual(['booked', 'accepted']) // the customer starts a new one
  expect((await pool.query('SELECT id, status, updated_at FROM requests WHERE customer_id = $1 ORDER BY id', [U.cust])).rows).toEqual(requestsBefore)
  expect((await kinds(kid.b)).map((n) => [n.user_id, n.kind])).toEqual([[U.cust, 'booking-expired'], [U.owner, 'booking-expired']])
})

// A lapsed root proposal reopens its request as soon as someone acts (no cron needed); reads only show it reopened.
const accept = (q: string) => asUser(U.cust, (tx) => acceptQuote(tx, U.cust, q, { startAt: at(24 * 5), durationMin: 60, onSite: true, address: { postcode: '10115' } }, new Date(NOW)))
const shown = async (x: { r: string; q: string }) => [
  (await asUser(U.cust, (tx) => getRequest(tx, U.cust, x.r, new Date(NOW)))).status,
  (await asUser(U.cust, (tx) => listRequests(tx, U.cust, 'customer', undefined, new Date(NOW)))).docs.find((r) => r.id === x.r)?.status,
  (await asUser(U.owner, (tx) => listRequests(tx, U.owner, 'provider', undefined, new Date(NOW)))).docs.find((r) => r.id === x.r)?.status,
  (await asUser(U.cust, (tx) => listQuotes(tx, U.cust, x.r, new Date(NOW)))).find((q) => q.id === x.q)?.status,
]
const mailedNull = async (b: string) => (await pool.query("SELECT count(*)::int AS n FROM notifications WHERE payload->>'bookingId' = $1 AND mailed_at IS NULL", [b])).rows[0].n as number

for (const kind of ['proposed', 'awaiting-payment'] as const) {
  it(`a lapsed ${kind} quote-born booking: reads show the job open again, and accepting the quote reopens it before any cron`, async () => {
    await clean()
    const x = await quoteBorn(kind, at(24 * 3))
    expect(await shown(x)).toEqual(['quoted', 'quoted', 'quoted', 'sent'])
    expect([await status('bookings', x.b), await status('requests', x.r), await status('quotes', x.q)]).toEqual([kind, 'booked', 'accepted']) // shown, not written
    const nb = await accept(x.q)
    expect(nb.status).toBe('proposed')
    expect([await status('bookings', x.b), await status('requests', x.r), await status('quotes', x.q)]).toEqual(['expired', 'booked', 'accepted']) // reopened, then booked again
    expect((await kinds(x.b)).filter((n) => n.user_id === U.cust)).toEqual([{ user_id: U.cust, kind: 'request-reopened', payload: { requestId: x.r, bookingId: x.b } }])
    expect(await mailedNull(x.b)).toBe(kind === 'proposed' ? 1 : 2) // the outbox sends them
    const before = await kinds(x.b)
    await run(0) // the cron afterwards: no second notice, nothing reopened again
    expect(await kinds(x.b)).toEqual(before)
    expect([await status('bookings', nb.id), await status('requests', x.r), await status('quotes', x.q)]).toEqual(['proposed', 'booked', 'accepted'])
  })
}

it('a lapsed quote-born proposal: the provider sends a revised quote before any cron', async () => {
  await clean()
  const x = await quoteBorn('proposed', at(24 * 3))
  const q2 = await asUser(U.owner, (tx) => sendQuote(tx, U.owner, x.r, { amount: 80, scope: 'rev' }, new Date(NOW)))
  expect([q2.status, q2.version]).toEqual(['sent', 2])
  expect([await status('bookings', x.b), await status('requests', x.r), await status('quotes', x.q)]).toEqual(['expired', 'quoted', 'superseded'])
  expect((await kinds(x.b)).map((n) => n.kind)).toEqual(['request-reopened'])
})

it('a lapsed quote-born proposal whose quote expired too: reads quoted/expired, accept is 409 quote-expired, one booking-expired notice', async () => {
  await clean()
  const x = await quoteBorn('proposed', at(-0.5))
  expect(await shown(x)).toEqual(['quoted', 'quoted', 'quoted', 'expired'])
  const res = await accept(x.q).catch((e: Response) => e)
  expect(res).toBeInstanceOf(Response)
  expect([(res as Response).status, await (res as Response).json()]).toEqual([409, { error: 'quote-expired' }])
  expect([await status('bookings', x.b), await status('requests', x.r), await status('quotes', x.q)]).toEqual(['expired', 'quoted', 'expired'])
  expect(await kinds(x.b)).toEqual([{ user_id: U.cust, kind: 'booking-expired', payload: { bookingId: x.b } }])
  const updated = (await pool.query('SELECT updated_at FROM requests WHERE id = $1', [x.r])).rows[0]
  await run(0)
  expect(await kinds(x.b)).toHaveLength(1)
  expect((await pool.query('SELECT updated_at FROM requests WHERE id = $1', [x.r])).rows[0]).toEqual(updated)
})

it('a lapsed open request cannot be withdrawn (it stays for the cron to expire)', async () => {
  await clean()
  const r = await request(prov, at(-1))
  const res = await asUser(U.cust, (tx) => withdrawRequest(tx, U.cust, r, new Date(NOW))).catch((e: Response) => e)
  expect([(res as Response).status, await (res as Response).json()]).toEqual([409, { error: 'request-closed' }])
  expect(await status('requests', r)).toBe('open')
})
