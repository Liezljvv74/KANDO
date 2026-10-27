import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { asUser, pool } from '@kando/db'
import { OwnReferenceSchema, OwnServiceSchema, OwnServicesListSchema, ReferencesListSchema } from '@kando/contract'
import { call, cleanupUsers, profile, seedBase } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const profileRoute = await import('../app/app-api/v1/provider-profile/route')
const services = await import('../app/app-api/v1/services/route')
const service = await import('../app/app-api/v1/services/[id]/route')
const references = await import('../app/app-api/v1/references/route')
const reference = await import('../app/app-api/v1/references/[id]/route')

let categoryId: string
let docCategoryId: string
beforeAll(async () => {
  ;({ categoryId, docCategoryId } = await seedBase())
  for (const u of ['sr1', 'sr2']) await call(profileRoute.PUT, u, 'PUT', profile)
})
afterAll(cleanupUsers)

const svc = (extra: object = {}) => ({ categoryId, title: 'Abends', priceType: 'hourly', price: 15, currency: 'EUR', ...extra })

it('a service needs a profile first (409)', async () => {
  const res = await call(services.POST, 'sr0', 'POST', svc())
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'Create your profile first' })
})

it('create, list and patch a service; shapes fit the contract', async () => {
  const res = await call(services.POST, 'sr1', 'POST', svc())
  expect(res.status).toBe(201)
  const created = OwnServiceSchema.parse(await res.json())
  expect(created).toMatchObject({ category: categoryId, price: 15, currency: 'EUR', priceType: 'hourly' })
  const list = OwnServicesListSchema.parse(await (await call(services.GET, 'sr1')).json())
  expect(list.docs.map((d) => d.id)).toEqual([created.id])
  expect(list.docs[0]).toMatchObject({ visibleInSearch: false, waitingFor: [], categoryInactive: false }) // draft profile
  const patched = await call(service.PATCH, 'sr1', 'PATCH', { title: 'Nachts' }, { id: created.id })
  expect(patched.status).toBe(200)
  expect(OwnServiceSchema.parse(await patched.json()).title).toBe('Nachts')
})

it('on-request has no price, even when one is sent', async () => {
  const res = await call(services.POST, 'sr1', 'POST', svc({ priceType: 'on-request', price: 99 }))
  expect(res.status).toBe(201)
  expect(OwnServiceSchema.parse(await res.json()).price).toBeNull()
  const stored = await pool.query("SELECT price FROM services WHERE price_type = 'on-request'")
  expect(stored.rows[0].price).toBeNull()
})

it('bad service input: no price, three decimals, unknown category are 400', async () => {
  expect((await call(services.POST, 'sr1', 'POST', svc({ price: null }))).status).toBe(400)
  expect((await call(services.POST, 'sr1', 'POST', svc({ price: 1.234 }))).status).toBe(400)
  const unknown = await call(services.POST, 'sr1', 'POST', svc({ categoryId: crypto.randomUUID() }))
  expect(unknown.status).toBe(400)
  expect(await unknown.json()).toEqual({ error: 'Unknown category' })
  expect((await call(services.POST, 'sr1', 'POST', svc({ categoryId: 'nope' }))).status).toBe(400)
})

it('a service in a category with required documents waits for approval', async () => {
  const res = await call(services.POST, 'sr1', 'POST', svc({ categoryId: docCategoryId, title: 'Kinder' }))
  const id = OwnServiceSchema.parse(await res.json()).id
  const find = async () =>
    OwnServicesListSchema.parse(await (await call(services.GET, 'sr1')).json()).docs.find((d) => d.id === id)!
  expect((await find()).waitingFor).toEqual(['police-certificate'])
  await pool.query(
    "INSERT INTO documents (owner_id, requirement, key, status) VALUES ('sr1', 'police-certificate', 'k', 'approved')",
  )
  expect((await find()).waitingFor).toEqual([])
})

it("user A cannot edit or delete user B's service", async () => {
  const id = OwnServiceSchema.parse(await (await call(services.POST, 'sr2', 'POST', svc({ title: 'Bs' }))).json()).id
  const patch = await call(service.PATCH, 'sr1', 'PATCH', { title: 'hacked' }, { id })
  const del = await call(service.DELETE, 'sr1', 'DELETE', undefined, { id })
  expect([patch.status, del.status]).toEqual([404, 404])
  expect((await pool.query('SELECT title FROM services WHERE id = $1', [id])).rows).toEqual([{ title: 'Bs' }])
  expect((await call(service.DELETE, 'sr2', 'DELETE', undefined, { id })).status).toBe(204)
  expect((await call(service.DELETE, 'sr2', 'DELETE', undefined, { id: 'not-a-uuid' })).status).toBe(404)
})

it('references are capped at 2 (409), can be patched and deleted', async () => {
  const ref = { clientName: 'Familie M.', description: 'Zwei Jahre', year: 2022 }
  const first = await call(references.POST, 'sr1', 'POST', ref)
  expect(first.status).toBe(201)
  const a = OwnReferenceSchema.parse(await first.json())
  expect((await call(references.POST, 'sr1', 'POST', { ...ref, year: null })).status).toBe(201)
  const third = await call(references.POST, 'sr1', 'POST', ref)
  expect(third.status).toBe(409)
  expect(await third.json()).toEqual({ error: 'Reference limit reached' })
  expect(ReferencesListSchema.parse(await (await call(references.GET, 'sr1')).json()).docs).toHaveLength(2)
  const patched = await call(reference.PATCH, 'sr1', 'PATCH', { description: 'Drei Jahre' }, { id: a.id })
  expect(OwnReferenceSchema.parse(await patched.json()).description).toBe('Drei Jahre')
  expect((await call(reference.PATCH, 'sr2', 'PATCH', { description: 'x' }, { id: a.id })).status).toBe(404)
  expect((await call(reference.DELETE, 'sr1', 'DELETE', undefined, { id: a.id })).status).toBe(204)
  expect((await call(references.POST, 'sr1', 'POST', ref)).status).toBe(201)
})

it('a service with a category alone is saved, not offerable, and a patch accepts the partial shape', async () => {
  const res = await call(services.POST, 'sr1', 'POST', { categoryId, currency: 'EUR' })
  expect(res.status).toBe(201)
  const s = OwnServiceSchema.parse(await res.json())
  expect(s).toMatchObject({ priceType: null, price: null })
  const patched = await call(service.PATCH, 'sr1', 'PATCH', { description: 'x', currency: 'EUR' }, { id: s.id })
  expect(OwnServiceSchema.parse(await patched.json())).toMatchObject({ priceType: null, description: 'x' })
})

const offerable = async (uid: string) =>
  (await asUser(uid, (tx) => tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM offerable_service_ids((SELECT id FROM providers WHERE owner_id = ${uid}))`))).rows[0]!.n

it('the price type and the price save in either order, each as its own one-field save', async () => {
  for (const order of [['priceType', 'price'], ['price', 'priceType']] as const) {
    const s = OwnServiceSchema.parse(await (await call(services.POST, 'sr1', 'POST', { categoryId, currency: 'EUR' })).json())
    const body = { priceType: { priceType: 'fixed' }, price: { price: 50 } }
    for (const k of order) expect((await call(service.PATCH, 'sr1', 'PATCH', body[k], { id: s.id })).status).toBe(200)
    const row = (await pool.query('SELECT price_type, price FROM services WHERE id = $1', [s.id])).rows[0]
    expect(row).toEqual({ price_type: 'fixed', price: '50.00' })
  }
})

it('a fixed service without a price is not offerable, with a price it is; on-request clears the price', async () => {
  const s = OwnServiceSchema.parse(await (await call(services.POST, 'sr2', 'POST', { categoryId, currency: 'EUR' })).json())
  await call(service.PATCH, 'sr2', 'PATCH', { priceType: 'fixed' }, { id: s.id })
  expect(await offerable('sr2')).toBe(0)
  const missing = async () => (await (await call(profileRoute.PUT, 'sr2', 'PUT', {})).json()).missing
  expect(await missing()).toContain('service')
  await call(service.PATCH, 'sr2', 'PATCH', { price: 40 }, { id: s.id })
  expect(await offerable('sr2')).toBe(1)
  expect(await missing()).not.toContain('service')
  await call(service.PATCH, 'sr2', 'PATCH', { priceType: 'on-request' }, { id: s.id })
  expect((await pool.query('SELECT price FROM services WHERE id = $1', [s.id])).rows[0].price).toBeNull()
  expect(await offerable('sr2')).toBe(1)
})
