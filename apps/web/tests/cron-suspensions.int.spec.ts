import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { clearOutbox, inBatches, outboxForTests } from '@kando/domain'
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
  expect(await res.json()).toEqual({ ended: expect.arrayContaining(['cr-past', 'cr-cust']) })
  expect(outboxForTests().map((m) => [m.to, m.subject])).toEqual([[EMAIL('cr-past'), 'Dein Profil ist wieder veröffentlicht']])
  expect((await pool.query("SELECT suspended_until, suspended_reason FROM users WHERE id = 'cr-past'")).rows[0]).toEqual({ suspended_until: null, suspended_reason: null })
  expect((await pool.query("SELECT suspended_until FROM providers WHERE owner_id = 'cr-past'")).rows[0].suspended_until).toBeNull()
  expect((await pool.query("SELECT suspended_until FROM providers WHERE owner_id = 'cr-future'")).rows[0].suspended_until).not.toBeNull()
  expect(await (await get('Bearer s3cret')).json()).toEqual({ ended: [] })
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
