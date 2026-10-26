import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { adminCall, cleanupUsers, EMAIL, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => (await import('./helpers')).mockAuth())
const list = await import('../app/api/admin/[resource]/route')
const item = await import('../app/api/admin/[resource]/[id]/route')
const me = await import('../app/api/admin/me/route')
const review = await import('../app/api/admin/documents/[id]/review/route')
const suspend = await import('../app/api/admin/users/[id]/suspend/route')

const ID = '00000000-0000-0000-0000-000000000001'
beforeAll(async () => {
  // The test database only: exactly one Administrator, so the last-Administrator rule is deterministic.
  await pool.query("UPDATE users SET staff_role = NULL WHERE staff_role = 'admin' AND email NOT LIKE '%@test.skilled.invalid'")
  await seedUser('ar-admin', 'admin')
  await seedUser('ar-rev', 'reviewer')
  await seedUser('ar-cust')
  await seedUser('ar-target')
})
afterAll(async () => {
  await pool.query("DELETE FROM categories WHERE slug LIKE 'ar-%'")
  await pool.query("DELETE FROM pages WHERE slug LIKE 'ar-%'")
  await cleanupUsers()
})

const category = { slug: 'ar-cat', sort: 1, requiredDocuments: [], names: { de: 'Eins', en: 'One' } }
const page = { slug: 'ar-page', kind: 'page', published: false, texts: { de: { title: 'T', body: 'B' } } }

it('a Reviewer cannot do Administrator actions, and nothing changes', async () => {
  const until = new Date(Date.now() + 86_400_000).toISOString()
  expect((await adminCall(suspend.POST, 'ar-rev', 'POST', '/x', { until, reason: 'x' }, { id: 'ar-target' })).status).toBe(403)
  expect((await adminCall(list.POST, 'ar-rev', 'POST', '/x', category, { resource: 'categories' })).status).toBe(403)
  expect((await adminCall(list.GET, 'ar-rev', 'GET', '/x', undefined, { resource: 'categories' })).status).toBe(403)
  expect((await adminCall(list.POST, 'ar-rev', 'POST', '/x', page, { resource: 'pages' })).status).toBe(403)
  expect((await adminCall(list.PATCH, 'ar-rev', 'PATCH', '/x', { email: EMAIL('ar-target'), staffRole: 'admin' }, { resource: 'staff' })).status).toBe(403)
  expect((await adminCall(list.GET, 'ar-rev', 'GET', '/x', undefined, { resource: 'staff' })).status).toBe(403)
  expect((await pool.query("SELECT 1 FROM categories WHERE slug = 'ar-cat'")).rowCount).toBe(0)
  expect((await pool.query("SELECT 1 FROM pages WHERE slug = 'ar-page'")).rowCount).toBe(0)
  const t = (await pool.query("SELECT suspended_until, staff_role FROM users WHERE id = 'ar-target'")).rows[0]
  expect(t).toEqual({ suspended_until: null, staff_role: null })
})

it('a Reviewer can read users and documents', async () => {
  expect((await adminCall(list.GET, 'ar-rev', 'GET', '/x', undefined, { resource: 'users' })).status).toBe(200)
  expect((await adminCall(list.GET, 'ar-rev', 'GET', '/x', undefined, { resource: 'documents' })).status).toBe(200)
  expect((await adminCall(me.GET, 'ar-rev')).status).toBe(200)
})

it('a customer with no staff role gets 403 on every admin route; no session gets 401', async () => {
  const calls = (uid: string) => [
    () => adminCall(me.GET, uid),
    ...['documents', 'users', 'providers', 'categories', 'pages', 'staff'].flatMap((resource) => [
      () => adminCall(list.GET, uid, 'GET', '/x', undefined, { resource }),
      () => adminCall(list.POST, uid, 'POST', '/x', {}, { resource }),
      () => adminCall(item.GET, uid, 'GET', '/x', undefined, { resource, id: ID }),
      () => adminCall(item.PATCH, uid, 'PATCH', '/x', {}, { resource, id: ID }),
      () => adminCall(item.DELETE, uid, 'DELETE', '/x', undefined, { resource, id: ID }),
    ]),
    () => adminCall(item.DELETE, uid, 'DELETE', '/x', undefined, { resource: 'photos', id: ID }),
    () => adminCall(list.PATCH, uid, 'PATCH', '/x', { email: EMAIL('ar-cust'), staffRole: 'admin' }, { resource: 'staff' }),
    () => adminCall(review.POST, uid, 'POST', '/x', { decision: 'approved' }, { id: ID }),
    () => adminCall(suspend.POST, uid, 'POST', '/x', { until: null, reason: '' }, { id: 'ar-target' }),
  ]
  for (const uid of ['ar-cust', '']) {
    const statuses = new Set<number>()
    for (const c of calls(uid)) statuses.add((await c()).status)
    expect(statuses).toEqual(new Set([uid ? 403 : 401]))
  }
  expect((await pool.query("SELECT staff_role FROM users WHERE id = 'ar-cust'")).rows[0].staff_role).toBeNull()
})

it('the last Administrator cannot be demoted', async () => {
  const demote = (staffRole: string | null) =>
    adminCall(list.PATCH, 'ar-admin', 'PATCH', '/x', { email: EMAIL('ar-admin'), staffRole }, { resource: 'staff' })
  expect((await demote('reviewer')).status).toBe(409)
  expect((await demote(null)).status).toBe(409)
  expect((await pool.query("SELECT staff_role FROM users WHERE id = 'ar-admin'")).rows[0].staff_role).toBe('admin')
  // With a second Administrator the first can be demoted.
  expect((await adminCall(list.PATCH, 'ar-admin', 'PATCH', '/x', { email: EMAIL('ar-target'), staffRole: 'admin' }, { resource: 'staff' })).status).toBe(200)
  expect((await demote('reviewer')).status).toBe(200)
})

const root = join(__dirname, '../app/api/admin')
const routes = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? routes(p) : n === 'route.ts' ? [p] : []
  })

it('every route file under app/api/admin exports handlers built with adminRequest', () => {
  const files = routes(root)
  expect(files.length).toBeGreaterThan(0)
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const exported = [...src.matchAll(/export\s+(?:async\s+)?(?:const|function)\s+(\w+)/g)].map((m) => m[1]!)
    const methods = exported.filter((n) => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(n))
    expect(methods.length, `${file} exports no HTTP method`).toBeGreaterThan(0)
    expect(exported.filter((n) => !methods.includes(n)), file).toEqual([])
    for (const m of methods) expect(src, `${file}: ${m}`).toMatch(new RegExp(`export\\s+const\\s+${m}\\s*=\\s*adminRequest\\(`))
    expect(/export\s*\{|export\s+default/.test(src), `${file} re-exports`).toBe(false)
  }
})
