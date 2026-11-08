import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { JobsPageSchema, RequestSchema, type JobsPage } from '@kando/contract'
import { call, cleanupUsers, EMAIL, makeAwaitingPayment, makeQuote, relaxLimits, requestTime, seedBase, seedProvider, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const jobs = await import('../app/app-api/v1/jobs/route')
const requestsRoute = await import('../app/app-api/v1/requests/route')

const U = { owner: 'jb-owner', owner2: 'jb-owner2', stranger: 'jb-stranger', c1: 'jb-c1', c2: 'jb-c2', c3: 'jb-c3', c4: 'jb-c4', c5: 'jb-c5', c6: 'jb-c6' }
const DAY = 86_400_000
const day = (n: number) => new Date(Date.now() + n * DAY).toISOString()
let providerId: string, provider2: string, serviceId: string

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
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
  expect(after.counts).toEqual({ needsYou: 1, unread: 1 })
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
  // newest first, no job twice
  expect(new Set(ids(past)).size).toBe(past.items.length)

  // a settled job with an unread message is in needs_you, not past
  await unreadNotice(U.c4, done.requestId!)
  expect(ids(await list(U.c4, { section: 'past' }))).not.toContain(done.requestId)
  expect((await list(U.c4)).items.find((i) => i.id === done.requestId)).toMatchObject({ unread: 1, jobState: { key: 'completed', section: 'needs_you' } })
})

it('search matches title, number and other party across sections', async () => {
  const all = [...(await list(U.owner, { role: 'provider', section: 'needs_you' })).items, ...(await list(U.owner, { role: 'provider', section: 'active' })).items, ...(await list(U.owner, { role: 'provider', section: 'past' })).items]
  const sections = new Set(all.map((i) => i.jobState.section))
  expect(sections.size).toBe(3)

  const byTitle = await list(U.owner, { role: 'provider', section: 'past', q: 'jobs owner SERVICE' })
  expect(ids(byTitle).sort()).toEqual(ids({ items: all } as JobsPage).sort()) // every section, whatever section was asked
  const one = all[0]!
  expect(ids(await list(U.owner, { role: 'provider', q: `#${one.number}` }))).toEqual([one.id])
  expect(ids(await list(U.owner, { role: 'provider', q: String(one.number) }))).toEqual([one.id])
  const byName = await list(U.owner, { role: 'provider', q: 'CARLA' })
  expect(byName.items.length).toBeGreaterThan(0)
  for (const i of byName.items) expect(i.otherParty).toBe('Carla V.')
  expect((await list(U.owner, { role: 'provider', q: 'nothing like this' })).items).toEqual([])
})

it('a person who is both sides gets separate counts per role', async () => {
  // the provider owner also books someone else, and has a quote to accept as a customer
  const { request } = await makeQuote({ customerId: U.owner, ownerId: U.owner2, providerId: provider2, startAt: day(25) })
  const asCustomer = await list(U.owner)
  expect(ids(asCustomer)).toEqual([request.id])
  expect(asCustomer.counts).toEqual({ needsYou: 1, unread: 0 })
  expect(asCustomer.items[0]!.otherParty).toBe('Other Owner')
  const quotedForC3 = (await pool.query("SELECT id FROM requests WHERE customer_id = $1 AND status = 'quoted'", [U.c3])).rows[0].id
  await unreadNotice(U.c3, quotedForC3, U.owner) // a message to the owner as provider
  const asProvider = await list(U.owner, { role: 'provider' })
  expect(ids(asProvider)).not.toContain(request.id)
  expect(asProvider.counts).toEqual({ needsYou: 2, unread: 1 }) // c2's request to answer, c3's job with the unread message (the customers' own notices are not the owner's)
  expect(asProvider.items.every((i) => i.jobState.countsForMe)).toBe(true)
  expect((await list(U.owner)).counts).toEqual({ needsYou: 1, unread: 0 }) // the customer side is untouched
})

it('RLS: another user\'s jobs never appear', async () => {
  for (const role of ['customer', 'provider'])
    for (const section of ['needs_you', 'active', 'past']) {
      const p = await list(U.stranger, { role, section })
      expect(p.items).toEqual([])
      expect(p.counts).toEqual({ needsYou: 0, unread: 0 })
    }
  expect((await list(U.stranger, { role: 'provider', q: 'Jobs' })).items).toEqual([])
  expect((await list(U.c1, { q: 'Carla' })).items).toEqual([]) // another customer's job is not c1's
})

it('a bad section or cursor is a 400', async () => {
  for (const q of ['section=all', 'cursor=nope'])
    expect((await jobs.GET(new Request(`http://localhost/app-api/v1/jobs?${q}`, { headers: { cookie: `uid=${U.c1}:${EMAIL(U.c1)}` } }), { params: Promise.resolve({}) })).status).toBe(400)
})
