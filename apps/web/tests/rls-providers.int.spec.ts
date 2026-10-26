import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { asUser, db, pool } from '@kando/db'
import { offerableServiceIds, missingRequirements, slugify } from '@kando/domain'
import { sql } from 'drizzle-orm'
import { call, cleanupUsers, profile, seedBase } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const profileRoute = await import('../app/app-api/v1/provider-profile/route')
const services = await import('../app/app-api/v1/services/route')
const references = await import('../app/app-api/v1/references/route')

let categoryId: string
let docCategoryId: string
let pid: string
let serviceId: string
let needyId: string
let referenceId: string
beforeAll(async () => {
  ;({ categoryId, docCategoryId } = await seedBase())
  await call(profileRoute.PUT, 'rp1', 'PUT', profile)
  await call(profileRoute.GET, 'rp2')
  pid = (await pool.query("SELECT id FROM providers WHERE owner_id = 'rp1'")).rows[0].id
  const body = { categoryId, title: 'A', priceType: 'fixed', price: 10, currency: 'EUR' }
  serviceId = (await (await call(services.POST, 'rp1', 'POST', body)).json()).id
  needyId = (await (await call(services.POST, 'rp1', 'POST', { ...body, categoryId: docCategoryId })).json()).id
  referenceId = (await (await call(references.POST, 'rp1', 'POST', { clientName: 'C', description: 'D' })).json()).id
  await pool.query("UPDATE providers SET status = 'published' WHERE id = $1", [pid]) // public rows: still not writable by others
})
afterAll(cleanupUsers)

const denied = { cause: { message: expect.stringContaining('row-level security') } }

it('another user cannot update or delete a service or a reference (rowCount 0, rows unchanged)', async () => {
  for (const [table, id, col] of [['services', serviceId, 'title'], ['provider_references', referenceId, 'client_name']] as const) {
    const upd = await asUser('rp2', (tx) => tx.execute(sql`UPDATE ${sql.raw(table)} SET ${sql.raw(col)} = 'hacked' WHERE id = ${id}`))
    const del = await asUser('rp2', (tx) => tx.execute(sql`DELETE FROM ${sql.raw(table)} WHERE id = ${id}`))
    expect([upd.rowCount, del.rowCount]).toEqual([0, 0])
    const row = (await pool.query(`SELECT ${col} AS v FROM ${table} WHERE id = $1`, [id])).rows
    expect(row).toHaveLength(1)
    expect(row[0].v).not.toBe('hacked')
  }
})

it('another user cannot insert a service or a reference for my provider', async () => {
  await expect(
    asUser('rp2', (tx) => tx.execute(sql`INSERT INTO provider_references (provider_id, client_name, description) VALUES (${pid}, 'x', 'y')`)),
  ).rejects.toMatchObject(denied)
  await expect(
    asUser('rp2', (tx) => tx.execute(sql`INSERT INTO services (provider_id, category_id, title, price_type) VALUES (${pid}, ${categoryId}, 't', 'on-request')`)),
  ).rejects.toMatchObject(denied)
})

it('the owner cannot move a service to another provider', async () => {
  await call(profileRoute.PUT, 'rp2', 'PUT', profile)
  const other = (await pool.query("SELECT id FROM providers WHERE owner_id = 'rp2'")).rows[0].id
  await expect(
    asUser('rp1', (tx) => tx.execute(sql`UPDATE services SET provider_id = ${other} WHERE id = ${serviceId}`)),
  ).rejects.toMatchObject(denied)
})

it('offerableServiceIds and missingRequirements are identical through tx and the owner db', async () => {
  const both = async () => {
    const viaTx = await asUser('rp1', async (tx) => [await offerableServiceIds(tx, pid), await missingRequirements(tx, pid, needyId)])
    const viaDb = [await offerableServiceIds(db, pid), await missingRequirements(db, pid, needyId)]
    return { viaTx, viaDb }
  }
  let r = await both()
  expect(r.viaDb).toEqual([[serviceId], ['police-certificate']])
  expect(r.viaTx).toEqual(r.viaDb)
  await pool.query("INSERT INTO documents (owner_id, requirement, key, status) VALUES ('rp1', 'police-certificate', 'k', 'approved')")
  r = await both()
  expect(r.viaDb[0]!.slice().sort()).toEqual([serviceId, needyId].sort())
  expect(r.viaDb[1]).toEqual([])
  expect(r.viaTx).toEqual(r.viaDb)
})

it('slugify strips accents', () => {
  expect(slugify('Josée')).toBe('josee')
})
