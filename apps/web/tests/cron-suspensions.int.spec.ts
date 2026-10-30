import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db, pool } from '@kando/db'
import { clearOutbox, inBatches, outboxForTests, pruneOldRows, purgeContactAttempts } from '@kando/domain'
import { cleanupUsers, EMAIL, seedBase, seedProvider } from './helpers'

const cron = await import('../app/api/cron/suspensions/route')
const get = (auth?: string) => cron.GET(new Request('http://localhost/api/cron/suspensions', { headers: auth ? { authorization: auth } : {} }))

beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', '')
  vi.stubEnv('CRON_SECRET', 's3cret')
  clearOutbox()
})
afterEach(() => vi.unstubAllEnvs())
afterAll(cleanupUsers)

it('401 without the right secret, and when CRON_SECRET is unset', async () => {
  expect((await get()).status).toBe(401)
  expect((await get('Bearer wrong')).status).toBe(401)
  vi.stubEnv('CRON_SECRET', '')
  expect((await get('Bearer ')).status).toBe(401)
  expect((await get('Bearer undefined')).status).toBe(401)
})

it('ends a past suspension once: both columns cleared, one email; a future one is left alone', async () => {
  const { categoryId } = await seedBase()
  await seedProvider('cr-past', { name: 'Past', categoryId })
  await seedProvider('cr-future', { name: 'Future', categoryId })
  await pool.query("INSERT INTO users (id, email, suspended_until, suspended_reason) VALUES ('cr-cust', $1, now() - interval '1 hour', 'old')", [EMAIL('cr-cust')]) // no profile: ended, no email
  await pool.query("UPDATE users SET suspended_until = now() - interval '1 hour', suspended_reason = 'old' WHERE id = 'cr-past'")
  await pool.query("UPDATE providers SET suspended_until = now() - interval '1 hour' WHERE owner_id = 'cr-past'")
  await pool.query("UPDATE users SET suspended_until = now() + interval '1 day', suspended_reason = 'new' WHERE id = 'cr-future'")
  await pool.query("UPDATE providers SET suspended_until = now() + interval '1 day' WHERE owner_id = 'cr-future'")
  const res = await get('Bearer s3cret')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ended: expect.arrayContaining(['cr-past', 'cr-cust']), pendingObjects: 0, purged: 0, pruned: { notifications: expect.any(Number), stripeEvents: expect.any(Number), pushTokens: expect.any(Number) }, contactAttempts: expect.any(Number) })
  expect(outboxForTests().map((m) => [m.to, m.subject])).toEqual([[EMAIL('cr-past'), 'Dein Profil ist wieder veröffentlicht']])
  expect((await pool.query("SELECT suspended_until, suspended_reason FROM users WHERE id = 'cr-past'")).rows[0]).toEqual({ suspended_until: null, suspended_reason: null })
  expect((await pool.query("SELECT suspended_until FROM providers WHERE owner_id = 'cr-past'")).rows[0].suspended_until).toBeNull()
  expect((await pool.query("SELECT suspended_until FROM providers WHERE owner_id = 'cr-future'")).rows[0].suspended_until).not.toBeNull()
  expect(await (await get('Bearer s3cret')).json()).toMatchObject({ ended: [], pendingObjects: 0, purged: 0 })
  expect(outboxForTests()).toHaveLength(1)
})

it('inBatches runs at most 5 at a time, and all of them', async () => {
  let running = 0
  let most = 0
  const done: number[] = []
  await inBatches([...Array(12).keys()], 5, async (n) => {
    most = Math.max(most, ++running)
    await new Promise((r) => setTimeout(r, 5))
    running--
    done.push(n)
  })
  expect(most).toBe(5)
  expect(done.sort((a, b) => a - b)).toEqual([...Array(12).keys()])
})

it('inBatches keeps the window full (a slow item does not hold back the next ones)', async () => {
  const started: number[] = []
  let release!: () => void
  const slow = new Promise<void>((r) => (release = r))
  const run = inBatches([0, 1, 2, 3, 4, 5], 2, async (n) => {
    started.push(n)
    if (n === 0) await slow // the first item stays busy while the second slot works through the rest
    else await new Promise((r) => setTimeout(r, 2))
  })
  await new Promise((r) => setTimeout(r, 60))
  expect(started).toEqual([0, 1, 2, 3, 4, 5])
  release()
  await run
})

it('inBatches does not stop at a rejecting item: the others still run, the failure is logged', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const done: number[] = []
  await inBatches([0, 1, 2, 3, 4], 2, async (n) => {
    if (n === 1) throw new Error('boom')
    done.push(n)
  })
  expect(done.sort()).toEqual([0, 2, 3, 4])
  expect(log).toHaveBeenCalled()
  log.mockRestore()
})

it('the daily check emails every ended profile (more than one batch)', async () => {
  const { categoryId } = await seedBase()
  const ids = Array.from({ length: 7 }, (_, i) => `cr-many${i}`)
  for (const id of ids) {
    await seedProvider(id, { name: id, categoryId })
    await pool.query("UPDATE users SET suspended_until = now() - interval '1 hour', suspended_reason = 'old' WHERE id = $1", [id])
    await pool.query("UPDATE providers SET suspended_until = now() - interval '1 hour' WHERE owner_id = $1", [id])
  }
  clearOutbox()
  expect(((await (await get('Bearer s3cret')).json()) as { ended: string[] }).ended.sort()).toEqual(ids)
  expect(outboxForTests().map((m) => m.to).sort()).toEqual(ids.map(EMAIL).sort())
})

it('pruneOldRows keeps unseen notices and requests-ignored, removes old seen ones, old stripe events and stale push tokens', async () => {
  await pool.query("INSERT INTO users (id, email) VALUES ('cr-prune', $1) ON CONFLICT DO NOTHING", [EMAIL('cr-prune')])
  const note = async (kind: string, seen: string | null, dismissed: string | null = null) =>
    (await pool.query(`INSERT INTO notifications (user_id, kind, created_at, seen_at, dismissed_at) VALUES ('cr-prune', $1, now() - interval '400 days', now() - $2::interval, now() - $3::interval) RETURNING id`, [kind, seen, dismissed])).rows[0].id as string
  const unseen = await note('booking-paid', null)
  await note('booking-paid', '181 days')
  await note('booking-paid', null, '181 days')
  const seenRecent = await note('booking-paid', '179 days')
  const ignored = await note('requests-ignored', '300 days')
  const waiting = await note('customers-waiting', '300 days')
  await pool.query("INSERT INTO stripe_events (id, type, received_at) VALUES ('evt_cr_old', 't', now() - interval '91 days'), ('evt_cr_new', 't', now() - interval '89 days') ON CONFLICT DO NOTHING")
  await pool.query("INSERT INTO push_tokens (user_id, token, platform, last_seen_at) VALUES ('cr-prune', 'ExponentPushToken[cr-old]', 'ios', now() - interval '271 days'), ('cr-prune', 'ExponentPushToken[cr-new]', 'ios', now() - interval '269 days')")
  const pruned = await pruneOldRows(db, new Date())
  expect(pruned.notifications).toBeGreaterThanOrEqual(2)
  expect(pruned.stripeEvents).toBeGreaterThanOrEqual(1)
  expect(pruned.pushTokens).toBeGreaterThanOrEqual(1)
  expect((await pool.query("SELECT id FROM notifications WHERE user_id = 'cr-prune'")).rows.map((r) => r.id).sort()).toEqual([unseen, seenRecent, ignored, waiting].sort())
  expect((await pool.query("SELECT id FROM stripe_events WHERE id LIKE 'evt_cr_%'")).rows).toEqual([{ id: 'evt_cr_new' }])
  expect((await pool.query("SELECT token FROM push_tokens WHERE user_id = 'cr-prune'")).rows).toEqual([{ token: 'ExponentPushToken[cr-new]' }])
  await pool.query("DELETE FROM stripe_events WHERE id LIKE 'evt_cr_%'")
})

it('the clean-up route declares maxDuration 60', () => {
  expect(cron.maxDuration).toBe(60)
})

it('the daily clean-up deletes contact attempts older than 90 days and keeps newer ones (and any of a user with an open flag)', async () => {
  for (const id of ['cr-att', 'cr-att-open']) await pool.query('INSERT INTO users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, EMAIL(id)])
  await pool.query("INSERT INTO contact_attempts (user_id, hit, text, created_at) VALUES ('cr-att', 'phone', 'old', now() - interval '91 days'), ('cr-att', 'phone', 'new', now() - interval '89 days'), ('cr-att-open', 'phone', 'old-open', now() - interval '120 days')")
  await pool.query("INSERT INTO staff_flags (kind, ref_id, user_id) VALUES ('contact-attempts', 'cr-att-open', 'cr-att-open')")
  expect(await purgeContactAttempts(db, new Date())).toBeGreaterThanOrEqual(1)
  expect((await pool.query("SELECT text FROM contact_attempts WHERE user_id IN ('cr-att', 'cr-att-open') ORDER BY text")).rows).toEqual([{ text: 'new' }, { text: 'old-open' }])
  await pool.query("UPDATE staff_flags SET resolved_at = now() WHERE user_id = 'cr-att-open'")
  expect(await purgeContactAttempts(db, new Date())).toBeGreaterThanOrEqual(1)
  expect((await pool.query("SELECT 1 FROM contact_attempts WHERE user_id = 'cr-att-open'")).rowCount).toBe(0)
})
