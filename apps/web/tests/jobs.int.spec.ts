import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { and, inArray } from 'drizzle-orm'
import { db, pool, requests } from '@kando/db'
import { JobsPageSchema, LIST_PAGE, RequestSchema, type JobsPage } from '@kando/contract'
import { settled } from '@kando/domain'
import { call, cleanupUsers, EMAIL, makeAwaitingPayment, makeQuote, relaxLimits, requestTime, seedBase, seedProvider, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
// A rule override for the drift test only: while on, a lapsed job (declined_expired, which the settled rule calls past) derives to Needs you.
const drift = vi.hoisted(() => ({ on: false }))
vi.mock('../../../packages/domain/src/bookings/job-state', async (real) => {
  const m = await real<typeof import('../../../packages/domain/src/bookings/job-state')>()
  return { ...m, leadState: (...a: Parameters<typeof m.leadState>) => { const s = m.leadState(...a); return drift.on && s.key === 'declined_expired' ? { ...s, section: 'needs_you', countsForMe: true } : s } }
})
const jobs = await import('../app/app-api/v1/jobs/route')
const requestsRoute = await import('../app/app-api/v1/requests/route')
const requestRoute = await import('../app/app-api/v1/requests/[id]/route')
const messagesRoute = await import('../app/app-api/v1/threads/[id]/messages/route')
const seenRoute = await import('../app/app-api/v1/threads/[id]/seen/route')

const U = { owner: 'jb-owner', owner2: 'jb-owner2', stranger: 'jb-stranger', c1: 'jb-c1', c2: 'jb-c2', c3: 'jb-c3', c4: 'jb-c4', c5: 'jb-c5', c6: 'jb-c6' }
const DAY = 86_400_000
const day = (n: number) => new Date(Date.now() + n * DAY).toISOString()
let providerId: string, provider2: string, serviceId: string, categoryId: string

beforeAll(async () => {
  await cleanupUsers()
  ;({ categoryId } = await seedBase())
  for (const [c, n] of [[U.stranger, 'Stella Fremd'], [U.c1, 'Ada Eins'], [U.c2, 'Bea Zwei'], [U.c3, 'Cem Drei'], [U.c4, 'Carla Vier'], [U.c5, 'Dora Fünf'], [U.c6, 'Emil Sechs'], [U.owner, 'Jobs Owner']] as const) await seedUser(c, null, n)
  providerId = await seedProvider(U.owner, { name: 'Jobs Owner', categoryId, price: 100 })
  provider2 = await seedProvider(U.owner2, { name: 'Other Owner', categoryId, price: 100 })
  serviceId = (await pool.query("SELECT id FROM services WHERE provider_id = $1", [providerId])).rows[0].id
  await pool.query("UPDATE providers SET stripe_account_id = 'acct_jb_' || left(id::text, 8), payouts_ready_at = now(), invoice_consent_at = now() WHERE id IN ($1, $2)", [providerId, provider2])
})
afterAll(cleanupUsers)

const list = async (uid: string, q: Record<string, string> = {}): Promise<JobsPage> => {
  const res = await jobs.GET(new Request(`http://localhost/app-api/v1/jobs?${new URLSearchParams(q)}`, { headers: { cookie: `uid=${uid}:${EMAIL(uid)}` } }), { params: Promise.resolve({}) })
  expect(res.status).toBe(200)
  return JobsPageSchema.parse(await res.json())
}
const ids = (p: JobsPage) => p.items.map((i) => i.id)

/** An open request (no quote yet) from `customerId` to `pid`. */
async function openRequest(customerId: string, pid = providerId): Promise<string> {
  await relaxLimits(customerId)
  const res = await call(requestsRoute.POST, customerId, 'POST', { providerId: pid, ...(pid === providerId && { serviceId }), description: 'Test job', ...requestTime() })
  if (!res.ok) throw new Error(`request ${res.status} ${await res.text()}`)
  return RequestSchema.parse(await res.json()).id
}

/** Moves a request's booking to completed (released or not) or cancelled, as the money steps leave it. */
const settle = (bookingId: string, status: 'completed' | 'cancelled', released: boolean) =>
  pool.query(`UPDATE bookings SET status = $2, paid_at = now(), payment_ref = 'pi_jb_' || gen_random_uuid(), commission_rate = 0.12, released_at = ${released ? 'now()' : 'NULL'} WHERE id = $1`, [bookingId, status])

/** A lapsed copy of the booking, created after it: the newest row of the request, but not the live one. */
const newerExpiredCopy = (bookingId: string) =>
  pool.query(
    `INSERT INTO bookings (customer_id, provider_id, service_id, quote_id, request_id, source, status, start_at, duration_min, created_at)
     SELECT customer_id, provider_id, service_id, quote_id, request_id, source, 'expired', start_at, duration_min, now() + interval '1 minute' FROM bookings WHERE id = $1`,
    [bookingId],
  )

/** A provider of its own (owner, name), for a test that must not see the other tests' jobs; returns provider and service id. */
async function ownProviderFor(uid: string, name: string): Promise<{ pid: string; sid: string }> {
  const pid = await seedProvider(uid, { name, categoryId, price: 100 })
  return { pid, sid: (await pool.query('SELECT id FROM services WHERE provider_id = $1', [pid])).rows[0].id }
}

type SeedBooking = { status: string; released?: boolean; minutesLater?: number }
/**
 * A job written straight into the tables (fast fixtures): a request with the given stored status, optionally a sent quote and
 * bookings (paid rows where the status needs it; `minutesLater` orders them). `daysAgo` sets the wished time and the bookings' start.
 */
async function seedJob(o: { customer: string; pid: string; sid: string; status: string; answerPast?: boolean; quote?: 'sent-expired' | 'sent-valid'; bookings?: SeedBooking[]; daysAgo?: number }): Promise<string> {
  const start = new Date(Date.now() - (o.daysAgo ?? 3) * DAY)
  const id = (
    await pool.query(
      `INSERT INTO requests (customer_id, provider_id, service_id, category_id, description, start_at, duration_min, on_site, status, answer_by)
       VALUES ($1, $2, $3, (SELECT category_id FROM services WHERE id = $3), 'Seeded job', $4, 60, false, $5, now() + ($6 || ' hours')::interval) RETURNING id`,
      [o.customer, o.pid, o.sid, start, o.status, o.answerPast ? '-1' : '72'],
    )
  ).rows[0].id as string
  if (o.quote) await pool.query("INSERT INTO quotes (request_id, provider_id, amount, scope, expires_at, status) VALUES ($1, $2, 100, 'Seeded', now() + ($3 || ' hours')::interval, 'sent')", [id, o.pid, o.quote === 'sent-valid' ? '72' : '-1'])
  if (o.bookings?.length) {
    const quote = (await pool.query("INSERT INTO quotes (request_id, provider_id, version, amount, scope, expires_at, status) VALUES ($1, $2, $3, 100, 'Seeded', now() + interval '7 days', 'accepted') RETURNING id", [id, o.pid, o.quote ? 2 : 1])).rows[0].id
    for (const b of o.bookings) {
      const paid = ['completed', 'cancelled', 'refunded'].includes(b.status)
      await pool.query(
        `INSERT INTO bookings (customer_id, provider_id, service_id, quote_id, request_id, source, status, start_at, duration_min, paid_at, payment_ref, commission_rate, released_at, created_at)
         VALUES ($1, $2, $3, $4, $5, 'quote', $6, $7, 60, ${paid ? "now(), 'pi_jb_' || gen_random_uuid(), 0.12" : 'NULL, NULL, NULL'}, ${b.released ? 'now()' : 'NULL'}, now() + ($8 || ' minutes')::interval)`,
        [o.customer, o.pid, o.sid, quote, id, b.status, start, String(b.minutesLater ?? 0)],
      )
    }
  }
  return id
}

/** Every page of a list, following `next`. */
async function walk(uid: string, q: Record<string, string>): Promise<{ items: JobsPage['items']; pages: number; last: JobsPage }> {
  let page = await list(uid, q)
  const items = [...page.items]
  let pages = 1
  while (page.next) {
    page = await list(uid, { ...q, cursor: page.next })
    items.push(...page.items)
    pages++
  }
  return { items, pages, last: page }
}

/** An unseen message notice for `to` (default: the customer) in the job's chat. */
const unreadNotice = async (customerId: string, requestId: string, to = customerId) => {
  const t = (await pool.query('INSERT INTO threads (request_id, customer_id, provider_id) VALUES ($1, $2, $3) ON CONFLICT (request_id) DO UPDATE SET customer_id = threads.customer_id RETURNING id', [requestId, customerId, providerId])).rows[0].id
  await pool.query("INSERT INTO notifications (user_id, kind, payload) VALUES ($1, 'message-received', $2)", [to, JSON.stringify({ threadId: t })])
}

it('a job with several bookings appears once, with the live booking\'s state', async () => {
  const b = await makeAwaitingPayment({ customerId: U.c1, ownerId: U.owner, providerId, serviceId, startAt: day(20) })
  // an older lapsed booking is the newest row: the live one still decides
  await newerExpiredCopy(b.id)
  const all = [...(await list(U.c1, { section: 'needs_you' })).items, ...(await list(U.c1, { section: 'active' })).items, ...(await list(U.c1, { section: 'past' })).items]
  const mine = all.filter((i) => i.id === b.requestId)
  expect(mine).toHaveLength(1)
  expect(mine[0]).toMatchObject({ number: expect.any(Number), title: 'Jobs Owner service', otherParty: 'Jobs Owner', unread: 0, jobState: { key: 'payment_due', section: 'needs_you' } })
  expect(Math.abs(Date.parse(mine[0]!.date) - Date.parse(day(20)))).toBeLessThan(60_000) // the booking's start
})

it('needs_you holds only actions that move the job forward', async () => {
  const open = await openRequest(U.c2)
  const { request: quoted } = await makeQuote({ customerId: U.c3, ownerId: U.owner, providerId, serviceId, startAt: day(21) })
  // the customer: a quote to accept needs them; their own open request waits for the provider (active)
  expect(ids(await list(U.c3))).toContain(quoted.id)
  expect(ids(await list(U.c2))).not.toContain(open)
  expect(ids(await list(U.c2, { section: 'active' }))).toContain(open)
  // the provider: a request to answer needs them; a quote they sent waits for the customer
  const pNeeds = await list(U.owner, { role: 'provider' })
  expect(ids(pNeeds)).toContain(open)
  expect(ids(pNeeds)).not.toContain(quoted.id)
  expect(ids(await list(U.owner, { role: 'provider', section: 'active' }))).toContain(quoted.id)
  for (const i of pNeeds.items) expect(i.jobState.section).toBe('needs_you')
  // an unread message alone moves an active job to needs_you, counted once however many messages
  await unreadNotice(U.c2, open)
  await unreadNotice(U.c2, open)
  const after = await list(U.c2)
  expect(after.items.find((i) => i.id === open)).toMatchObject({ unread: 1, jobState: { section: 'needs_you' } })
  expect(after.counts).toEqual({ needsYou: 1, unread: 1, past: 0 })
})

it('past holds only settled jobs', async () => {
  const done = await makeAwaitingPayment({ customerId: U.c4, ownerId: U.owner, providerId, serviceId, startAt: day(22) })
  await settle(done.id, 'completed', true)
  await newerExpiredCopy(done.id) // not settled by the SQL rule (newest row expired): derived in code and merged into Past
  const unpaid = await makeAwaitingPayment({ customerId: U.c5, ownerId: U.owner, providerId, serviceId, startAt: day(23) })
  await settle(unpaid.id, 'completed', false) // finished, money not settled: stays active
  const cancelled = await makeAwaitingPayment({ customerId: U.c6, ownerId: U.owner, providerId, serviceId, startAt: day(24) })
  await settle(cancelled.id, 'cancelled', false)
  const lapsed = await openRequest(U.c6)
  await pool.query("UPDATE requests SET answer_by = now() - interval '1 hour' WHERE id = $1", [lapsed]) // not yet written expired by the timer
  const withdrawn = await openRequest(U.c5)
  await pool.query("UPDATE requests SET status = 'withdrawn' WHERE id = $1", [withdrawn])

  const past = await list(U.owner, { role: 'provider', section: 'past' })
  expect(ids(past)).toEqual(expect.arrayContaining([done.requestId, cancelled.requestId, lapsed, withdrawn]))
  expect(ids(past)).not.toContain(unpaid.requestId)
  for (const i of past.items) expect(i.jobState.section).toBe('past')
  expect(past.items.find((i) => i.id === done.requestId)?.jobState.key).toBe('completed')
  expect(ids(await list(U.owner, { role: 'provider', section: 'active' }))).toContain(unpaid.requestId)
  // no job twice, and the folded header's count is the whole list
  expect(new Set(ids(past)).size).toBe(past.items.length)
  expect(past.counts.past).toBe(past.items.length)

  // a settled job with an unread message is in needs_you, not past
  await unreadNotice(U.c4, done.requestId!)
  expect(ids(await list(U.c4, { section: 'past' }))).not.toContain(done.requestId)
  expect((await list(U.c4)).items.find((i) => i.id === done.requestId)).toMatchObject({ unread: 1, jobState: { key: 'completed', section: 'needs_you' } })
})

it('search matches title, number and other party across sections', async () => {
  const { pid, sid } = await ownProviderFor('jb-sowner', 'Sucher Owner')
  for (const [c, n] of [['jb-s1', 'Sina Eins'], ['jb-s2', 'Timo Zwei'], ['jb-s3', 'Rosa Drei']] as const) await seedUser(c, null, n)
  const needs = await seedJob({ customer: 'jb-s1', pid, sid, status: 'open' }) // a request to answer
  const active = await seedJob({ customer: 'jb-s2', pid, sid, status: 'quoted', quote: 'sent-valid' }) // waits for the customer
  const past = await seedJob({ customer: 'jb-s3', pid, sid, status: 'withdrawn' })
  const as = (q: Record<string, string>) => list('jb-sowner', { role: 'provider', ...q })
  expect((await as({ section: 'needs_you' })).items.map((i) => [i.id, i.jobState.section])).toEqual([[needs, 'needs_you']])
  expect(ids(await as({ section: 'active' }))).toEqual([active])
  expect(ids(await as({ section: 'past' }))).toEqual([past])

  const byTitle = await as({ section: 'past', q: 'sucher owner SERVICE' }) // every section, whatever section was asked
  expect(byTitle.items.map((i) => i.jobState.section).sort()).toEqual(['active', 'needs_you', 'past'])
  const one = byTitle.items.find((i) => i.id === active)!
  expect(ids(await as({ q: `#${one.number}` }))).toEqual([active])
  expect(ids(await as({ q: String(one.number) }))).toEqual([active])
  const byName = await as({ q: 'ROSA' })
  expect(byName.items.map((i) => [i.id, i.otherParty])).toEqual([[past, 'Rosa D.']])
  expect((await as({ q: 'nothing like this' })).items).toEqual([])
})

it('a person who is both sides gets separate counts per role', async () => {
  // the provider owner also books someone else, and has a quote to accept as a customer
  const { request } = await makeQuote({ customerId: U.owner, ownerId: U.owner2, providerId: provider2, startAt: day(25) })
  const asCustomer = await list(U.owner)
  expect(ids(asCustomer)).toEqual([request.id])
  expect(asCustomer.counts).toEqual({ needsYou: 1, unread: 0, past: 0 })
  expect(asCustomer.items[0]!.otherParty).toBe('Other Owner')
  const quotedForC3 = (await pool.query("SELECT id FROM requests WHERE customer_id = $1 AND status = 'quoted'", [U.c3])).rows[0].id
  await unreadNotice(U.c3, quotedForC3, U.owner) // a message to the owner as provider
  const asProvider = await list(U.owner, { role: 'provider' })
  expect(ids(asProvider)).not.toContain(request.id)
  expect(asProvider.counts).toMatchObject({ needsYou: 2, unread: 1 }) // c2's request to answer, c3's job with the unread message (the customers' own notices are not the owner's)
  expect(asProvider.items.every((i) => i.jobState.countsForMe)).toBe(true)
  expect((await list(U.owner)).counts).toEqual({ needsYou: 1, unread: 0, past: 0 }) // the customer side is untouched
})

it('an additional task is part of its job: it leads the row while it needs someone, keeps the job out of Past, and is listed on the job page for the parties only', async () => {
  const { pid, sid } = await ownProviderFor('jb-towner', 'Task Owner')
  await seedUser('jb-t1', null, 'Tara Task')
  const root = await seedJob({ customer: 'jb-t1', pid, sid, status: 'booked', bookings: [{ status: 'completed', released: true }] }) // paid out: past
  const rootBooking = (await pool.query('SELECT id FROM bookings WHERE request_id = $1', [root])).rows[0].id
  const task = (
    await pool.query(
      `INSERT INTO requests (customer_id, provider_id, service_id, category_id, parent_booking_id, description, status, answer_by)
       VALUES ($1, $2, $3, (SELECT category_id FROM services WHERE id = $3), $4, 'Noch das Tor', 'open', now() + interval '72 hours') RETURNING id`,
      ['jb-t1', pid, sid, rootBooking],
    )
  ).rows[0].id as string
  const where = async (uid: string, role: string) => {
    for (const section of ['needs_you', 'active', 'past']) {
      const p = await list(uid, { role, section })
      const row = p.items.find((i) => i.id === root)
      if (row) return { section, key: row.jobState.key, counts: p.counts, rows: p.items.filter((i) => i.id === root).length }
    }
    return null
  }

  // the task's new request needs the provider: the job is under Needs you once, counted once, not in Past
  expect(await where('jb-towner', 'provider')).toEqual({ section: 'needs_you', key: 'request_sent', counts: { needsYou: 1, unread: 0, past: 0 }, rows: 1 })
  expect(ids(await list('jb-towner', { role: 'provider', section: 'past' }))).toEqual([])
  expect(await where('jb-t1', 'customer')).toMatchObject({ section: 'active', key: 'request_sent', counts: { past: 0 } })

  // quoted and accepted, awaiting payment: the customer must pay (Needs you); the provider waits (Active); still not Past
  const quote = (await pool.query("INSERT INTO quotes (request_id, provider_id, amount, scope, expires_at, status) VALUES ($1, $2, 40, 'Tor', now() + interval '7 days', 'accepted') RETURNING id", [task, pid])).rows[0].id
  await pool.query("UPDATE requests SET status = 'booked' WHERE id = $1", [task])
  const taskBooking = (
    await pool.query(
      `INSERT INTO bookings (customer_id, provider_id, service_id, quote_id, request_id, parent_booking_id, source, status, start_at, duration_min, pay_by, accepted_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'quote', 'awaiting-payment', now() - interval '3 days', 60, now() + interval '24 hours', now()) RETURNING id`,
      ['jb-t1', pid, sid, quote, task, rootBooking],
    )
  ).rows[0].id
  expect(await where('jb-t1', 'customer')).toMatchObject({ section: 'needs_you', key: 'payment_due', counts: { needsYou: 1, past: 0 }, rows: 1 })
  expect(await where('jb-towner', 'provider')).toMatchObject({ section: 'active', key: 'payment_due', counts: { needsYou: 0, past: 0 } })

  // the job page lists the task (with its own state) to both parties; the task's own page has no task list; a stranger gets 404
  const page = (uid: string, id: string) => call(requestRoute.GET, uid, 'GET', undefined, { id })
  for (const uid of ['jb-t1', 'jb-towner']) {
    const r = RequestSchema.parse(await (await page(uid, root)).json())
    expect(r.tasks).toEqual([{ id: task, jobState: expect.objectContaining({ key: 'payment_due' }) }])
    expect(r.bookingIds).toEqual([rootBooking]) // the task's booking is on the task's page
    expect(RequestSchema.parse(await (await page(uid, task)).json()).tasks).toBeUndefined()
  }
  expect((await page(U.stranger, root)).status).toBe(404)

  // the task cancelled: nothing live is left, the job is Past again (the SQL rule, no drift)
  await pool.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [taskBooking])
  expect(await where('jb-t1', 'customer')).toMatchObject({ section: 'past', key: 'completed', counts: { needsYou: 0, past: 1 } })
  expect(await where('jb-towner', 'provider')).toMatchObject({ section: 'past', key: 'completed', counts: { needsYou: 0, past: 1 } })
})

it('opening the chat (POST seen) clears its message notices on the server, also those beyond the newest 20 that /me lists; the poll (GET) changes nothing', async () => {
  const { pid, sid } = await ownProviderFor('jb-mowner', 'Chat Owner')
  await seedUser('jb-m1', null, 'Mia Chat')
  const job = await seedJob({ customer: 'jb-m1', pid, sid, status: 'open' })
  const thread = (await pool.query('INSERT INTO threads (request_id, customer_id, provider_id) VALUES ($1, $2, $3) RETURNING id', [job, 'jb-m1', pid])).rows[0].id
  await pool.query("INSERT INTO notifications (user_id, kind, payload, created_at) SELECT 'jb-m1', 'message-received', $1, now() - (i || ' minutes')::interval FROM generate_series(1, 25) AS i", [JSON.stringify({ threadId: thread })])
  await pool.query("INSERT INTO notifications (user_id, kind, payload) VALUES ('jb-m1', 'message-received', $1)", [JSON.stringify({ threadId: randomUUID() })]) // another chat's: untouched
  const unseen = async () => (await pool.query("SELECT payload->>'threadId' AS t FROM notifications WHERE user_id = 'jb-m1' AND seen_at IS NULL")).rows.map((r: { t: string }) => r.t)
  expect((await list('jb-m1', { section: 'needs_you' })).items.find((i) => i.id === job)?.unread).toBe(1)
  // a stranger's mark is a 404 and changes nothing; the party's read (the poll) is read-only
  expect((await call(seenRoute.POST, U.stranger, 'POST', undefined, { id: thread })).status).toBe(404)
  expect((await call(messagesRoute.GET, 'jb-m1', 'GET', undefined, { id: thread })).status).toBe(200)
  expect(await unseen()).toHaveLength(26)
  expect((await call(seenRoute.POST, 'jb-m1', 'POST', undefined, { id: thread })).status).toBe(204)
  expect(await unseen()).toHaveLength(1)
  expect(await unseen()).not.toContain(thread)
  const after = await list('jb-m1', { section: 'active' })
  expect(after.items.find((i) => i.id === job)?.unread).toBe(0)
  expect(after.counts.unread).toBe(0)
})

it('a job the settled rule calls past but the state does not (drift) shows in its own section, and the counters agree', async () => {
  const { pid, sid } = await ownProviderFor('jb-downer', 'Drift Owner')
  await seedUser('jb-d1', null, 'Dana Drift')
  const lapsed = await seedJob({ customer: 'jb-d1', pid, sid, status: 'withdrawn' })
  const other = await seedJob({ customer: 'jb-d1', pid, sid, status: 'declined', daysAgo: 5 })
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  drift.on = true
  try {
    const past = await list('jb-d1', { section: 'past' })
    expect(past.items).toEqual([]) // the drifted rows are not in Past ...
    expect(past.counts).toMatchObject({ needsYou: 2, past: 0 }) // ... nor counted there
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('settled rule drifted'))
    const needs = await list('jb-d1', { section: 'needs_you' }) // ... but where their state says, also on later loads
    expect(ids(needs).sort()).toEqual([lapsed, other].sort())
    expect(needs.counts).toMatchObject({ needsYou: 2, past: 0 })
  } finally {
    drift.on = false
    spy.mockRestore()
  }
  // the rule back in line: the remembered rows are derived in code and land in Past again
  const back = await list('jb-d1', { section: 'past' })
  expect(ids(back).sort()).toEqual([lapsed, other].sort())
  expect(back.counts).toMatchObject({ needsYou: 0, past: 2 })
})

it('RLS: another user\'s jobs never appear', async () => {
  for (const role of ['customer', 'provider'])
    for (const section of ['needs_you', 'active', 'past']) {
      const p = await list(U.stranger, { role, section })
      expect(p.items).toEqual([])
      expect(p.counts).toEqual({ needsYou: 0, unread: 0, past: 0 })
    }
  expect((await list(U.stranger, { role: 'provider', q: 'Jobs' })).items).toEqual([])
  expect((await list(U.c1, { q: 'Carla' })).items).toEqual([]) // another customer's job is not c1's
})

it('a bad section or cursor is a 400', async () => {
  for (const q of ['section=all', 'cursor=nope'])
    expect((await jobs.GET(new Request(`http://localhost/app-api/v1/jobs?${q}`, { headers: { cookie: `uid=${U.c1}:${EMAIL(U.c1)}` } }), { params: Promise.resolve({}) })).status).toBe(400)
})

it('every stored combination the SQL past rule settles derives to past (the rule and deriveJobState agree)', async () => {
  const { pid, sid } = await ownProviderFor('jb-kowner', 'Kombi Owner')
  await seedUser('jb-k1', null, 'Kai Kombi')
  const job = (status: string, more: Partial<Parameters<typeof seedJob>[0]> = {}) => seedJob({ customer: 'jb-k1', pid, sid, status, ...more })
  const combos: Record<string, string> = {
    'request withdrawn': await job('withdrawn'),
    'request declined': await job('declined'),
    'request expired': await job('expired'),
    'open past its answer date': await job('open', { answerPast: true }),
    'quoted, every sent quote expired': await job('quoted', { quote: 'sent-expired' }),
    'booked, completed and released': await job('booked', { bookings: [{ status: 'completed', released: true }] }),
    'booked, cancelled': await job('booked', { bookings: [{ status: 'cancelled' }] }),
    'booked, refunded': await job('booked', { bookings: [{ status: 'refunded' }] }),
    'quoted again after a lapsed booking, its quote expired': await job('quoted', { quote: 'sent-expired', bookings: [{ status: 'expired' }] }),
    'open again past its answer date after a declined booking': await job('open', { answerPast: true, bookings: [{ status: 'declined' }] }),
    'released job, newest booking cancelled': await job('booked', { bookings: [{ status: 'completed', released: true }, { status: 'cancelled', minutesLater: 1 }] }),
  }
  // not settled in SQL (newest row withdrawn, request booked): derived in code, still past
  const derivedOnly = await job('booked', { bookings: [{ status: 'completed', released: true }, { status: 'withdrawn', minutesLater: 1 }] })
  const settledNow = async (ids: string[]) => new Set((await db.select({ id: requests.id }).from(requests).where(and(inArray(requests.id, ids), settled(new Date())))).map((r) => r.id))
  const inSql = await settledNow([...Object.values(combos), derivedOnly])
  const past = await list('jb-k1', { section: 'past' })
  for (const [name, id] of Object.entries(combos)) {
    expect(inSql.has(id), name).toBe(true)
    expect(past.items.find((i) => i.id === id)?.jobState.section, name).toBe('past')
  }
  expect(inSql.has(derivedOnly)).toBe(false)
  expect(past.items.find((i) => i.id === derivedOnly)?.jobState.key).toBe('completed')
  expect(past.counts.past).toBe(Object.keys(combos).length + 1)
  expect(past.items).toHaveLength(Object.keys(combos).length + 1)
  // and the live ones are never settled: an open request, a valid quote, a confirmed booking, a completed job not paid out
  const live = [
    await job('open'),
    await job('quoted', { quote: 'sent-valid' }),
    await job('booked', { bookings: [{ status: 'confirmed' }] }),
    await job('booked', { bookings: [{ status: 'completed', released: false }] }),
  ]
  expect((await settledNow(live)).size).toBe(0)
})

it('Past and a search walk across pages: latest job date first, no duplicates, no gaps, an open-set past job included', async () => {
  const { pid, sid } = await ownProviderFor('jb-powner', 'Pager Owner')
  await seedUser('jb-p1', null, 'Paul Pager')
  const n = LIST_PAGE + 5
  // n settled jobs, two per job date (ties broken by id), plus one past job that only the derived path finds, dated in the middle
  const seeded: string[] = (
    await pool.query(
      `INSERT INTO requests (customer_id, provider_id, service_id, category_id, description, start_at, duration_min, on_site, status, answer_by)
       SELECT $1, $2, $3, (SELECT category_id FROM services WHERE id = $3), 'Seeded job', date_trunc('minute', now()) - ((i / 2) || ' days')::interval, 60, false, 'withdrawn', now()
       FROM generate_series(1, $4::int) AS i RETURNING id`,
      ['jb-p1', pid, sid, n],
    )
  ).rows.map((r: { id: string }) => r.id)
  const fromOpen = await seedJob({ customer: 'jb-p1', pid, sid, status: 'booked', daysAgo: 10.5, bookings: [{ status: 'completed', released: true }, { status: 'withdrawn', minutesLater: 1 }] })
  const all = [...seeded, fromOpen]

  for (const q of [{ section: 'past' }, { q: 'pager owner' }] as Record<string, string>[]) {
    const { items, pages, last } = await walk('jb-p1', q)
    expect(pages, JSON.stringify(q)).toBe(2)
    expect(items.map((i) => i.id).sort()).toEqual([...all].sort()) // no gap
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length) // no duplicate
    for (let k = 1; k < items.length; k++) expect(Date.parse(items[k - 1]!.date)).toBeGreaterThanOrEqual(Date.parse(items[k]!.date))
    expect(items.find((i) => i.id === fromOpen)?.jobState.key).toBe('completed')
    expect(last.counts.past).toBe(all.length)
  }
})
