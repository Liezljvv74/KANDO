import { afterAll, beforeAll, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { and, inArray } from 'drizzle-orm'
import { db, pool, requests } from '@kando/db'
import { COMMISSION_RATE, settled } from '@kando/domain'
import { leadState } from '../../../packages/domain/src/bookings/job-state'
import { jobStates } from '../../../packages/domain/src/bookings/job-state-lookup'
import { lapsedRoots, toRequest } from '../../../packages/domain/src/bookings/requests'
import { cleanupUsers, seedBase, seedProvider, seedUser } from './helpers'

/**
 * The invariant behind the Jobs list: the SQL `settled` rule (Past is paged in the database) may only call a job settled if
 * deriveJobState says "past" for it, for both sides. Every combination of what `settled` reads is built and checked:
 *   request: status (all 6) x answer date (past/future) x sent quotes (none, expired, valid, both)
 *   bookings of the request: none, one, or two (the second newer), each one of
 *     - a live status (awaiting-time, awaiting-payment, confirmed, finished, disputed, stopped), which must keep the job out of `settled`
 *     - a dead status (expired, declined, withdrawn, cancelled, refunded) x released_at (null / set)
 *     - completed x released_at (null / set) x completed 2 or 30 days ago x reviews (none, customer only, provider only, both)
 * Signals the code reads that SQL cannot (unread messages, open money flags, live additional tasks) are not inputs here: the list
 * moves such jobs out of the settled set first (alwaysDerived), so they are derived in code anyway. Change either rule so that they
 * disagree and this fails, naming the combination.
 */
const OWNER = 'jbx-owner'
const CUSTOMER = 'jbx-customer'
let pid: string, sid: string

beforeAll(async () => {
  await cleanupUsers()
  const { categoryId } = await seedBase()
  await seedUser(CUSTOMER, null, 'Kim Kombi')
  await seedUser(OWNER, null, 'Invariant Owner')
  pid = await seedProvider(OWNER, { name: 'Invariant Owner', categoryId, price: 100 })
  sid = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [pid])).rows[0].id
  await pool.query("UPDATE providers SET stripe_account_id = 'acct_jbx', payouts_ready_at = now(), invoice_consent_at = now() WHERE id = $1", [pid])
})
afterAll(cleanupUsers, 600_000)

type Slot = { st: string; released: boolean; completedDaysAgo: number | null; reviews: 'none' | 'customer' | 'provider' | 'both'; label: string }
const slots: Slot[] = []
for (const st of ['awaiting-time', 'awaiting-payment', 'confirmed', 'finished', 'disputed', 'stopped']) slots.push({ st, released: false, completedDaysAgo: null, reviews: 'none', label: st })
for (const st of ['expired', 'declined', 'withdrawn', 'cancelled', 'refunded']) for (const released of [false, true]) slots.push({ st, released, completedDaysAgo: null, reviews: 'none', label: `${st}${released ? ' released' : ''}` })
for (const released of [false, true])
  for (const completedDaysAgo of [2, 30]) for (const reviews of ['none', 'customer', 'provider', 'both'] as const) slots.push({ st: 'completed', released, completedDaysAgo, reviews, label: `completed${released ? ' released' : ''} ${completedDaysAgo}d reviews:${reviews}` })
const sequences: Slot[][] = [[], ...slots.map((s) => [s]), ...slots.flatMap((a) => slots.map((b) => [a, b]))]

type Combo = { id: string; status: string; answerPast: boolean; quote: 'none' | 'expired' | 'valid' | 'both'; seq: Slot[]; name: string }
const combos: Combo[] = []
for (const status of ['open', 'quoted', 'booked', 'expired', 'withdrawn', 'declined'])
  for (const answerPast of [false, true])
    for (const quote of ['none', 'expired', 'valid', 'both'] as const)
      for (const seq of sequences) combos.push({ id: randomUUID(), status, answerPast, quote, seq, name: `request ${status}${answerPast ? ' answer date past' : ''}, quotes ${quote}, bookings [${seq.map((s) => s.label).join(' > ')}]` })

async function seedAll() {
  const CHUNK = 4000
  for (let i = 0; i < combos.length; i += CHUNK) {
    const part = combos.slice(i, i + CHUNK)
    await pool.query(
      `INSERT INTO requests (id, customer_id, provider_id, service_id, category_id, description, start_at, duration_min, on_site, status, answer_by)
       SELECT u.id, $1::text, $2::uuid, $3::uuid, (SELECT category_id FROM services WHERE id = $3), 'Invariant job', now() - interval '3 days', 60, false, u.status, now() + (CASE WHEN u.past THEN '-1' ELSE '72' END || ' hours')::interval
       FROM unnest($4::uuid[], $5::text[], $6::boolean[]) AS u(id, status, past)`,
      [CUSTOMER, pid, sid, part.map((c) => c.id), part.map((c) => c.status), part.map((c) => c.answerPast)],
    )
    const quoteRows = part.flatMap((c) => [
      ...(c.quote === 'expired' || c.quote === 'both' ? [{ r: c.id, v: 1, st: 'sent', exp: '-1' }] : []),
      ...(c.quote === 'valid' || c.quote === 'both' ? [{ r: c.id, v: 2, st: 'sent', exp: '72' }] : []),
    ])
    const accepted = part.filter((c) => c.seq.length).map((c) => ({ r: c.id, q: randomUUID() }))
    await pool.query(
      `INSERT INTO quotes (id, request_id, provider_id, version, amount, scope, expires_at, status)
       SELECT gen_random_uuid(), u.r, $1::uuid, u.v, 100, 'Seeded', now() + (u.exp || ' hours')::interval, u.st FROM unnest($2::uuid[], $3::int[], $4::text[], $5::text[]) AS u(r, v, st, exp)
       UNION ALL
       SELECT a.q, a.r, $1::uuid, 3, 100, 'Seeded', now() + interval '7 days', 'accepted' FROM unnest($6::uuid[], $7::uuid[]) AS a(r, q)`,
      [pid, quoteRows.map((q) => q.r), quoteRows.map((q) => q.v), quoteRows.map((q) => q.st), quoteRows.map((q) => q.exp), accepted.map((a) => a.r), accepted.map((a) => a.q)],
    )
    const quoteOf = new Map(accepted.map((a) => [a.r, a.q]))
    const rows = part.flatMap((c) => c.seq.map((s, k) => ({ id: randomUUID(), r: c.id, q: quoteOf.get(c.id)!, s, k })))
    await pool.query(
      `INSERT INTO bookings (id, customer_id, provider_id, service_id, quote_id, request_id, status, start_at, duration_min, pay_by, accepted_at, paid_at, payment_ref, commission_rate, released_at, completed_at, created_at)
       SELECT u.id, $1::text, $2::uuid, $3::uuid, u.q, u.r, u.st, now() - interval '3 days', 60,
         CASE WHEN u.st = 'awaiting-payment' THEN now() + interval '1 hour' END, CASE WHEN u.st = 'awaiting-payment' THEN now() END,
         CASE WHEN u.paid THEN now() END, CASE WHEN u.paid THEN 'pi_jbx_' || gen_random_uuid() END, ${COMMISSION_RATE}, CASE WHEN u.rel THEN now() END,
         CASE WHEN u.days IS NOT NULL THEN now() - (u.days || ' days')::interval END, now() + (u.k || ' minutes')::interval
       FROM unnest($4::uuid[], $5::uuid[], $6::uuid[], $7::text[], $8::boolean[], $9::boolean[], $10::int[], $11::int[]) AS u(id, r, q, st, paid, rel, days, k)`,
      [CUSTOMER, pid, sid, rows.map((b) => b.id), rows.map((b) => b.r), rows.map((b) => b.q), rows.map((b) => b.s.st), rows.map((b) => ['completed', 'cancelled', 'refunded', 'confirmed', 'finished', 'disputed', 'stopped'].includes(b.s.st)), rows.map((b) => b.s.released), rows.map((b) => b.s.completedDaysAgo), rows.map((b) => b.k)],
    )
    const reviewRows = rows.flatMap((b) => [
      ...(b.s.reviews === 'customer' || b.s.reviews === 'both' ? [{ b: b.id, author: CUSTOMER, subject: OWNER, role: 'customer' }] : []),
      ...(b.s.reviews === 'provider' || b.s.reviews === 'both' ? [{ b: b.id, author: OWNER, subject: CUSTOMER, role: 'provider' }] : []),
    ])
    if (reviewRows.length)
      await pool.query(
        `INSERT INTO reviews (booking_id, author_id, subject_id, author_role, stars) SELECT u.b, u.a, u.s, u.r, 5 FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[]) AS u(b, a, s, r)`,
        [reviewRows.map((r) => r.b), reviewRows.map((r) => r.author), reviewRows.map((r) => r.subject), reviewRows.map((r) => r.role)],
      )
  }
}

it('whatever the SQL past rule settles, deriveJobState calls past (all combinations, both sides)', async () => {
  await seedAll()
  const now = new Date()
  const byId = new Map(combos.map((c) => [c.id, c]))
  const settledIds: string[] = []
  for (let i = 0; i < combos.length; i += 5000) {
    const ids = combos.slice(i, i + 5000).map((c) => c.id)
    settledIds.push(...(await db.select({ id: requests.id }).from(requests).where(and(inArray(requests.id, ids), settled(now)))).map((r) => r.id))
  }
  // a job with a live booking is never settled, whatever else it holds
  const live = ['awaiting-time', 'awaiting-payment', 'confirmed', 'finished', 'disputed', 'stopped']
  for (const id of settledIds) expect(byId.get(id)!.seq.some((s) => live.includes(s.st)), byId.get(id)!.name).toBe(false)

  const wrong: string[] = []
  for (const viewer of ['customer', 'provider'] as const) {
    const userId = viewer === 'customer' ? CUSTOMER : OWNER
    for (let i = 0; i < settledIds.length; i += 1500) {
      const rows = await db.select().from(requests).where(inArray(requests.id, settledIds.slice(i, i + 1500)))
      const lapsed = await lapsedRoots(db as never, rows.map((r) => r.id), now)
      const dtos = rows.map((r) => toRequest(r, now, lapsed.get(r.id)))
      const states = await jobStates(db, userId, dtos.map((r) => ({ key: r.id, viewer, providerId: r.providerId, requestId: r.id, parentBookingId: r.parentBookingId, request: { status: r.status, answerBy: new Date(r.answerBy) } })), now)
      for (const r of rows) {
        const s = leadState(states.get(r.id)!, [])
        if (s.section !== 'past') wrong.push(`${viewer}: ${byId.get(r.id)!.name} -> ${s.key}/${s.section}`)
      }
    }
  }
  console.log(`[jobs-settled-invariant] ${combos.length} combinations, ${settledIds.length} settled by SQL, checked for 2 sides, ${wrong.length} disagreements`)
  expect(settledIds.length).toBeGreaterThan(1000) // not vacuous
  expect(wrong.slice(0, 20)).toEqual([])
  expect(wrong).toHaveLength(0)
}, 900_000)
