import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { asUser, pool } from '@kando/db'
import { SearchResultSchema } from '@kando/contract'
import { sql } from 'drizzle-orm'
import { cleanupUsers, seedBase, seedProvider } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const route = await import('../app/app-api/v1/providers/route')

let categoryId: string
const cats: string[] = []
beforeAll(async () => {
  ;({ categoryId } = await seedBase())
})
afterAll(async () => {
  await cleanupUsers()
  await pool.query('DELETE FROM categories WHERE id = ANY($1::uuid[])', [cats])
})

const newCategory = async (docs: string[]) => {
  const id = (await pool.query('INSERT INTO categories (slug, required_documents) VALUES ($1, $2) RETURNING id', [`of-${Date.now()}-${cats.length}`, docs])).rows[0].id as string
  cats.push(id)
  return id
}
const flag = async (providerId: string) => (await pool.query('SELECT offerable FROM services WHERE provider_id = $1', [providerId])).rows[0].offerable as boolean
const found = async (q: string) => {
  const res = await route.GET(new Request(`http://localhost/app-api/v1/providers?q=${q}`), { params: Promise.resolve({}) })
  return SearchResultSchema.parse(await res.json()).items.map((i) => i.slug)
}

it('approving the last required document makes the service offerable', async () => {
  const cat = await newCategory(['police-certificate', 'first-aid-certificate'])
  const pid = await seedProvider('of-last', { name: 'Of Last', categoryId: cat, skills: ['oflasttest'] })
  expect(await flag(pid)).toBe(false)
  await pool.query("INSERT INTO documents (owner_id, requirement, key, status) VALUES ('of-last', 'police-certificate', 'k1', 'approved')")
  expect(await flag(pid)).toBe(false) // one of two
  const doc = (await pool.query("INSERT INTO documents (owner_id, requirement, key, status) VALUES ('of-last', 'first-aid-certificate', 'k2', 'pending') RETURNING id")).rows[0].id
  expect(await flag(pid)).toBe(false) // pending does not count
  expect(await found('oflasttest')).toEqual([])
  await pool.query("UPDATE documents SET status = 'approved' WHERE id = $1", [doc])
  expect(await flag(pid)).toBe(true)
  expect(await found('oflasttest')).toEqual(['of-last-slug'])
})

it('a new required document removes the services from search at once', async () => {
  const cat = await newCategory([])
  const pid = await seedProvider('of-newreq', { name: 'Of Newreq', categoryId: cat, skills: ['ofnewreqtest'] })
  expect(await flag(pid)).toBe(true)
  expect(await found('ofnewreqtest')).toEqual(['of-newreq-slug'])
  await pool.query("UPDATE categories SET required_documents = ARRAY['police-certificate'] WHERE id = $1", [cat])
  expect(await flag(pid)).toBe(false)
  expect(await found('ofnewreqtest')).toEqual([])
  await pool.query("UPDATE categories SET required_documents = '{}' WHERE id = $1", [cat])
  expect(await flag(pid)).toBe(true)
})

it('deleting an approved document or clearing the price clears the flag', async () => {
  const cat = await newCategory(['police-certificate'])
  const pid = await seedProvider('of-del', { name: 'Of Del', categoryId: cat, skills: ['ofdeltest'] })
  await pool.query("INSERT INTO documents (owner_id, requirement, key, status) VALUES ('of-del', 'police-certificate', 'k', 'approved')")
  expect(await flag(pid)).toBe(true)
  await pool.query("DELETE FROM documents WHERE owner_id = 'of-del'")
  expect(await flag(pid)).toBe(false)
  expect(await found('ofdeltest')).toEqual([])

  const plain = await seedProvider('of-price', { name: 'Of Price', categoryId, skills: ['ofpricetest'] })
  expect(await flag(plain)).toBe(true)
  await pool.query('UPDATE services SET price = NULL WHERE provider_id = $1', [plain]) // fixed without a price
  expect(await flag(plain)).toBe(false)
  await pool.query("UPDATE services SET price_type = 'on-request' WHERE provider_id = $1", [plain])
  expect(await flag(plain)).toBe(true)
  await pool.query('UPDATE services SET price_type = NULL WHERE provider_id = $1', [plain])
  expect(await flag(plain)).toBe(false)
})

// Two real transactions on separate connections. `second` runs while `first` is open; we wait until it has either
// finished (no lock to wait on) or is blocked on a lock, then commit `first`. Deterministic either way.
const interleave = async (first: (c: import('pg').PoolClient) => Promise<unknown>, second: (c: import('pg').PoolClient) => Promise<unknown>) => {
  const [a, b] = [await pool.connect(), await pool.connect()]
  try {
    await a.query('BEGIN')
    await first(a)
    const pidB = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    let done = false
    const running = second(b).finally(() => (done = true))
    for (;;) {
      if (done) break
      const w = await pool.query("SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'", [pidB])
      if (w.rowCount) break
      await new Promise((r) => setTimeout(r, 10))
    }
    await a.query('COMMIT')
    await running
  } finally {
    a.release()
    b.release()
  }
}
const insertService = (pid: string, cat: string) => (c: import('pg').PoolClient) =>
  c.query("INSERT INTO services (provider_id, category_id, title, price_type, price) VALUES ($1, $2, 'race', 'fixed', 5)", [pid, cat])
const raceFlag = async (pid: string) => (await pool.query("SELECT offerable FROM services WHERE provider_id = $1 AND title = 'race'", [pid])).rows[0].offerable as boolean

it('a document deleted while a service is being added leaves the new service not offerable', async () => {
  const cat = await newCategory(['police-certificate'])
  const pid = await seedProvider('of-race-del', { name: 'Of Race Del', categoryId: cat })
  await pool.query("INSERT INTO documents (owner_id, requirement, key, status) VALUES ('of-race-del', 'police-certificate', 'k', 'approved')")
  // the insert is open (and computed offerable) when the delete runs
  await interleave(insertService(pid, cat), (c) => c.query("DELETE FROM documents WHERE owner_id = 'of-race-del'"))
  expect(await raceFlag(pid)).toBe(false)
})

it('the last document approved while a service is being added leaves the new service offerable', async () => {
  const cat = await newCategory(['police-certificate'])
  const pid = await seedProvider('of-race-ok', { name: 'Of Race Ok', categoryId: cat })
  await pool.query("INSERT INTO documents (owner_id, requirement, key, status) VALUES ('of-race-ok', 'police-certificate', 'k', 'pending')")
  // the approval is open when the insert runs
  await interleave((c) => c.query("UPDATE documents SET status = 'approved' WHERE owner_id = 'of-race-ok'"), insertService(pid, cat))
  expect(await raceFlag(pid)).toBe(true)
})

it('app_user cannot write offerable', async () => {
  const cat = await newCategory(['police-certificate'])
  const pid = await seedProvider('of-own', { name: 'Of Own', categoryId: cat })
  const svc = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [pid])).rows[0].id
  const denied = { cause: { message: expect.stringContaining('permission denied') } }
  await expect(asUser('of-own', (tx) => tx.execute(sql`UPDATE services SET offerable = true WHERE id = ${svc}`))).rejects.toMatchObject(denied)
  await expect(
    asUser('of-own', (tx) => tx.execute(sql`INSERT INTO services (provider_id, category_id, title, price_type, price, offerable) VALUES (${pid}, ${cat}, 'x', 'fixed', 5, true)`)),
  ).rejects.toMatchObject(denied)
  // an insert or a price change by the owner is computed, never taken: still not offerable without the document
  await asUser('of-own', (tx) => tx.execute(sql`INSERT INTO services (provider_id, category_id, title, price_type, price) VALUES (${pid}, ${cat}, 'y', 'fixed', 5)`))
  await asUser('of-own', (tx) => tx.execute(sql`UPDATE services SET price = 7 WHERE provider_id = ${pid}`))
  expect((await pool.query('SELECT bool_or(offerable) AS any FROM services WHERE provider_id = $1', [pid])).rows[0].any).toBe(false)
})
