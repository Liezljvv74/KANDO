import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { asUser, pool } from '@kando/db'
import { MyProfileSchema } from '@kando/contract'
import { offerableServiceIds } from '@kando/domain'
import { sql } from 'drizzle-orm'
import { call, EMAIL, givePhoto, cleanupUsers, profile, seedBase } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const profileRoute = await import('../app/app-api/v1/provider-profile/route')
const publish = await import('../app/app-api/v1/provider-profile/publish/route')
const unpublish = await import('../app/app-api/v1/provider-profile/unpublish/route')
const services = await import('../app/app-api/v1/services/route')

let categoryId: string
let docCategoryId: string
beforeAll(async () => {
  ;({ categoryId, docCategoryId } = await seedBase())
  for (const u of ['pf1', 'pf2', 'pf3'])
    await pool.query(
      "INSERT INTO users (id, email, first_name, last_name) VALUES ($1, $2, 'Pia', 'Fuchs') ON CONFLICT (id) DO UPDATE SET first_name = 'Pia', last_name = 'Fuchs'",
      [u, EMAIL(u)],
    )
})
afterAll(cleanupUsers)

const rows = (uid: string | null, q: ReturnType<typeof sql>) => asUser(uid, async (tx) => (await tx.execute(q)).rows)
const denied = (message: string) => ({ cause: { message: expect.stringContaining(message) } })

it('the first-time flow: refused until photo and service exist, then published, then unpublished', async () => {
  expect((await call(publish.POST, 'pf1', 'POST')).status).toBe(404) // no profile
  await call(profileRoute.PUT, 'pf1', 'PUT', { ...profile, skills: [], experience: null })
  const refused = await call(publish.POST, 'pf1', 'POST')
  expect(refused.status).toBe(409)
  expect(await refused.json()).toEqual({ error: 'Profile incomplete', missing: ['photo', 'service', 'skills', 'experience'] })
  await givePhoto('pf1') // Task 6 uploads for real
  await call(profileRoute.PUT, 'pf1', 'PUT', profile)
  await call(services.POST, 'pf1', 'POST', { categoryId, title: 'A', priceType: 'fixed', price: 10, currency: 'EUR' })
  const ok = await call(publish.POST, 'pf1', 'POST')
  expect(ok.status).toBe(200)
  expect(MyProfileSchema.parse(await ok.json())).toMatchObject({ status: 'published' })
  const down = await call(unpublish.POST, 'pf1', 'POST')
  expect(MyProfileSchema.parse(await down.json())).toMatchObject({ status: 'draft' })
})

it('a postcode-less profile is refused until a postcode is saved', async () => {
  await call(profileRoute.PUT, 'pf2', 'PUT', { providerType: 'individual', skills: ['a'], experience: '1 Jahr' })
  await givePhoto('pf2')
  await call(services.POST, 'pf2', 'POST', { categoryId, title: 'A', priceType: 'fixed', price: 10, currency: 'EUR' })
  const refused = await call(publish.POST, 'pf2', 'POST')
  expect((await refused.json()).missing).toEqual(['postcode'])
  await call(profileRoute.PUT, 'pf2', 'PUT', { basePostcode: '10115' })
  expect((await call(publish.POST, 'pf2', 'POST')).status).toBe(200)
})

it('a suspended profile cannot publish (409)', async () => {
  await pool.query("UPDATE providers SET suspended_until = now() + interval '1 day', status = 'draft' WHERE owner_id = 'pf2'")
  const res = await call(publish.POST, 'pf2', 'POST')
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'Profile suspended' })
})

it('RLS: published and not suspended is public, drafts and suspended are not', async () => {
  await call(publish.POST, 'pf1', 'POST')
  expect(await rows(null, sql`SELECT 1 FROM providers WHERE owner_id = 'pf1'`)).toHaveLength(1)
  expect(await rows(null, sql`SELECT 1 FROM providers WHERE owner_id = 'pf2'`)).toHaveLength(0) // suspended
  const live = sql`SELECT 1 FROM services s JOIN providers p ON p.id = s.provider_id WHERE p.owner_id = 'pf1'`
  expect((await rows('pf3', live)).length).toBeGreaterThan(0) // a published provider's services are public
  await call(unpublish.POST, 'pf1', 'POST')
  expect(await rows('pf3', sql`SELECT 1 FROM providers WHERE owner_id = 'pf1'`)).toHaveLength(0)
  expect(await rows('pf3', live)).toHaveLength(0)
  expect(await rows('pf1', sql`SELECT 1 FROM providers WHERE owner_id = 'pf1'`)).toHaveLength(1)
})

it('RLS: another user cannot change or add to a provider; domain-only columns are closed', async () => {
  const upd = await asUser('pf3', (tx) => tx.execute(sql`UPDATE providers SET bio = 'x' WHERE owner_id = 'pf1'`))
  expect(upd.rowCount).toBe(0)
  const pid = (await pool.query("SELECT id FROM providers WHERE owner_id = 'pf1'")).rows[0].id
  await expect(
    asUser('pf3', (tx) =>
      tx.execute(sql`INSERT INTO services (provider_id, category_id, title, price_type) VALUES (${pid}, ${categoryId}, 't', 'on-request')`),
    ),
  ).rejects.toMatchObject(denied('row-level security'))
  for (const set of [sql`status = 'published'`, sql`suspended_until = NULL`, sql`slug = 'x'`, sql`public_name = 'x'`, sql`location = NULL`]) {
    await expect(
      asUser('pf1', (tx) => tx.execute(sql`UPDATE providers SET ${set} WHERE owner_id = 'pf1'`)),
    ).rejects.toMatchObject(denied('permission denied'))
  }
})

it("RLS: set_provider_* touch only the caller's own profile", async () => {
  await asUser('pf3', (tx) => tx.execute(sql`SELECT set_provider_identity('Hijack', 1, 1)`))
  expect((await pool.query("SELECT public_name FROM providers WHERE owner_id = 'pf1'")).rows[0].public_name).not.toBe('Hijack')
  const r = await asUser('pf3', async (tx) => (await tx.execute(sql`SELECT set_provider_published(true, 'x') AS ok`)).rows[0])
  expect(r).toEqual({ ok: false }) // pf3 has no profile
})

it('RLS: documents are private and the verdict is staff-only', async () => {
  await pool.query("INSERT INTO documents (owner_id, requirement, key) VALUES ('pf1', 'police-certificate', 'k1')")
  expect(await rows('pf3', sql`SELECT 1 FROM documents`)).toHaveLength(0)
  expect(await rows(null, sql`SELECT 1 FROM documents`)).toHaveLength(0)
  await expect(
    asUser('pf1', (tx) => tx.execute(sql`UPDATE documents SET status = 'approved' WHERE owner_id = 'pf1'`)),
  ).rejects.toMatchObject(denied('permission denied'))
  const ins = await asUser('pf1', (tx) =>
    tx.execute(sql`INSERT INTO documents (owner_id, requirement, key) VALUES ('pf1', 'permit', 'k2') RETURNING status`),
  )
  expect(ins.rows[0]).toEqual({ status: 'pending' })
  await expect(
    asUser('pf3', (tx) => tx.execute(sql`INSERT INTO documents (owner_id, requirement, key) VALUES ('pf1', 'x', 'k3')`)),
  ).rejects.toMatchObject(denied('row-level security'))
})

it('offerableServiceIds: services whose required documents are all approved', async () => {
  const pid = (await pool.query("SELECT id FROM providers WHERE owner_id = 'pf1'")).rows[0].id
  const plain = (await pool.query('SELECT id FROM services WHERE provider_id = $1', [pid])).rows[0].id
  const needy = (
    await pool.query(
      "INSERT INTO services (provider_id, category_id, title, price_type) VALUES ($1, $2, 'K', 'on-request') RETURNING id",
      [pid, docCategoryId],
    )
  ).rows[0].id
  const ids = () => asUser('pf1', (tx) => offerableServiceIds(tx, pid))
  expect(await ids()).toEqual([plain]) // only pending documents so far
  await pool.query("UPDATE documents SET status = 'approved' WHERE owner_id = 'pf1' AND key = 'k1'")
  expect((await ids()).sort()).toEqual([plain, needy].sort())
})

it('a user suspension that has ended no longer blocks publishing; a running one does (403)', async () => {
  await pool.query("UPDATE providers SET suspended_until = NULL, status = 'draft' WHERE owner_id = 'pf2'")
  await pool.query("UPDATE users SET suspended_until = now() + interval '1 day', suspended_reason = 'x' WHERE id = 'pf2'")
  expect((await call(publish.POST, 'pf2', 'POST')).status).toBe(403) // the wrapper refuses every write of a suspended person
  await pool.query("UPDATE users SET suspended_until = now() - interval '1 minute' WHERE id = 'pf2'")
  expect((await call(publish.POST, 'pf2', 'POST')).status).toBe(200)
})
