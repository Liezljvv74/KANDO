import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { asUser, db, pool } from '@kando/db'
import { getPage, getPublicProfile, listCategories, offerableServiceIds, setStorageForTests, visibleProviderSlugs } from '@kando/domain'
import { endExpiredSuspensions } from '@kando/domain'
import { TIME_ZONE } from '@kando/i18n'
import { clearOutbox, outboxForTests } from '@kando/domain'
import { adminCall, call, cleanupUsers, EMAIL, givePhoto, memoryStorage, profile, seedBase, seedProvider, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ ...(await (await import('./helpers')).mockAuth()), sessionFromRequest: (await import('./helpers')).fakeSession }))
const list = await import('../app/api/admin/[resource]/route')
const item = await import('../app/api/admin/[resource]/[id]/route')
const me = await import('../app/api/admin/me/route')
const review = await import('../app/api/admin/documents/[id]/review/route')
const suspend = await import('../app/api/admin/users/[id]/suspend/route')
const profileRoute = await import('../app/app-api/v1/provider-profile/route')
const publish = await import('../app/app-api/v1/provider-profile/publish/route')
const services = await import('../app/app-api/v1/services/route')

const anon = <T>(f: Parameters<typeof asUser<T>>[1]) => asUser(null, f)
const store = memoryStorage()
let categoryId: string
let docCategoryId: string
let providerId: string
beforeEach(() => vi.stubEnv('RESEND_API_KEY', ''))
afterEach(() => vi.unstubAllEnvs())

beforeAll(async () => {
  setStorageForTests(store)
  await seedUser('aa-admin', 'admin')
  await seedUser('aa-rev', 'reviewer')
  ;({ categoryId, docCategoryId } = await seedBase())
  providerId = await seedProvider('aa-owner', { name: 'Owner A', categoryId })
  await pool.query("INSERT INTO services (provider_id, category_id, title, price_type) VALUES ($1, $2, 'Needs check', 'on-request')", [providerId, docCategoryId])
})
afterAll(async () => {
  setStorageForTests(undefined)
  await pool.query("DELETE FROM categories WHERE slug LIKE 'aa-%'")
  await pool.query("DELETE FROM pages WHERE slug LIKE 'aa-%'")
  await cleanupUsers()
})

const get = (resource: string, uid: string, query = '', id?: string) =>
  adminCall(id ? item.GET : list.GET, uid, 'GET', `/api/admin/${resource}${query}`, undefined, id ? { resource, id } : { resource })
const doc = async (owner: string, status = 'pending') =>
  (await pool.query("INSERT INTO documents (owner_id, requirement, key, status) VALUES ($1, 'police-certificate', 'documents/x.pdf', $2) RETURNING id", [owner, status])).rows[0].id as string

it('lists documents with the pending ones first, with owner email', async () => {
  await seedUser('aa-d1')
  const approved = await doc('aa-d1', 'approved')
  await seedUser('aa-d3')
  const pending = await doc('aa-d3')
  const body = await (await get('documents', 'aa-rev', '?pageSize=100')).json()
  const ids = body.data.map((d: { id: string }) => d.id)
  expect(ids.indexOf(pending)).toBeLessThan(ids.indexOf(approved))
  expect(body.total).toBeGreaterThanOrEqual(2)
  expect(body.data.find((d: { id: string }) => d.id === pending).ownerEmail).toBe(EMAIL('aa-d3'))
  const only = await (await get('documents', 'aa-rev', `?filter=${encodeURIComponent('{"status":"pending"}')}`)).json()
  expect(only.data.every((d: { status: string }) => d.status === 'pending')).toBe(true)
  const one = await (await get('documents', 'aa-rev', '', pending)).json()
  expect(one.data.id).toBe(pending)
  expect(one.data.link).toContain('signed.test')
})

it('approving a document makes the service offerable and records the reviewer', async () => {
  const id = await doc('aa-owner')
  const before = await offerableServiceIds(db, providerId)
  clearOutbox()
  const res = await adminCall(review.POST, 'aa-rev', 'POST', '/x', { decision: 'approved' }, { id })
  expect(res.status).toBe(200)
  expect(outboxForTests().map((m) => [m.to, m.subject])).toEqual([[EMAIL('aa-owner'), 'Dein Profil ist online']])
  expect(outboxForTests()[0]!.text).toContain('/providers/aa-owner-slug')
  const row = (await pool.query('SELECT status, reviewed_by, reviewed_at FROM documents WHERE id = $1', [id])).rows[0]
  expect(row.status).toBe('approved')
  expect(row.reviewed_by).toBe('aa-rev')
  expect(row.reviewed_at).not.toBeNull()
  expect((await offerableServiceIds(db, providerId)).length).toBe(before.length + 1)
  // Decided documents stay decided.
  expect((await adminCall(review.POST, 'aa-rev', 'POST', '/x', { decision: 'rejected', note: 'late' }, { id })).status).toBe(409)
})

it('rejecting stores the note, and needs one', async () => {
  await seedUser('aa-d2')
  const id = await doc('aa-d2')
  clearOutbox()
  expect((await adminCall(review.POST, 'aa-rev', 'POST', '/x', { decision: 'rejected' }, { id })).status).toBe(400)
  expect(outboxForTests()).toHaveLength(0)
  await pool.query("UPDATE users SET language = 'en' WHERE id = 'aa-d2'")
  clearOutbox()
  expect((await adminCall(review.POST, 'aa-rev', 'POST', '/x', { decision: 'rejected', note: 'Unreadable scan' }, { id })).status).toBe(200)
  const mails = outboxForTests()
  expect(mails).toHaveLength(1)
  expect(mails[0]).toMatchObject({ to: EMAIL('aa-d2'), subject: 'Your document was rejected' })
  expect(mails[0]!.text).toContain('Police certificate')
  expect(mails[0]!.text).toContain('Unreadable scan')
  const row = (await pool.query('SELECT status, note FROM documents WHERE id = $1', [id])).rows[0]
  expect(row).toEqual({ status: 'rejected', note: 'Unreadable scan' })
  expect((await adminCall(review.POST, 'aa-rev', 'POST', '/x', { decision: 'approved' }, { id: '00000000-0000-0000-0000-000000000009' })).status).toBe(404)
})

it('suspending a user hides the provider from search and the public page; lifting shows it again', async () => {
  const slug = 'aa-sus-slug'
  const sid = await seedProvider('aa-sus', { name: 'Suspend Me', categoryId })
  const visible = async () => (await anon((tx) => visibleProviderSlugs(tx))).some((p) => p.slug === slug) && !!(await anon((tx) => getPublicProfile(tx, slug, 'de')))
  expect(await visible()).toBe(true)
  const until = new Date(Date.now() + 7 * 86_400_000).toISOString()
  expect((await adminCall(suspend.POST, 'aa-admin', 'POST', '/x', { until, reason: '' }, { id: 'aa-sus' })).status).toBe(400)
  const res = await adminCall(suspend.POST, 'aa-admin', 'POST', '/x', { until, reason: 'Complaints' }, { id: 'aa-sus' })
  expect(res.status).toBe(200)
  const u = (await pool.query("SELECT suspended_until, suspended_reason FROM users WHERE id = 'aa-sus'")).rows[0]
  expect(new Date(u.suspended_until).toISOString()).toBe(until)
  expect(u.suspended_reason).toBe('Complaints')
  expect(new Date((await pool.query('SELECT suspended_until FROM providers WHERE id = $1', [sid])).rows[0].suspended_until).toISOString()).toBe(until)
  expect(await visible()).toBe(false)
  const [mail] = outboxForTests().slice(-1)
  expect(mail).toMatchObject({ to: EMAIL('aa-sus'), subject: 'Dein Profil wurde gesperrt' })
  expect(mail!.text).toContain('Complaints')
  expect(mail!.text).toContain(new Date(until).toLocaleDateString('de-DE', { timeZone: TIME_ZONE }))
  await pool.query("UPDATE providers SET suspended_until = now() - interval '1 minute' WHERE id = $1", [sid])
  expect(await visible()).toBe(true) // the date passed: shown again without any lift
  await pool.query('UPDATE providers SET suspended_until = $2 WHERE id = $1', [sid, until])
  clearOutbox()
  expect((await adminCall(suspend.POST, 'aa-admin', 'POST', '/x', { until: null, reason: '' }, { id: 'aa-sus' })).status).toBe(200)
  expect(outboxForTests().map((m) => [m.to, m.subject])).toEqual([[EMAIL('aa-sus'), 'Dein Profil ist wieder veröffentlicht']])
  expect((await pool.query("SELECT suspended_until FROM users WHERE id = 'aa-sus'")).rows[0].suspended_until).toBeNull()
  expect(await visible()).toBe(true)
  expect((await adminCall(suspend.POST, 'aa-admin', 'POST', '/x', { until: null, reason: '' }, { id: 'aa-nobody' })).status).toBe(404)
})

it('suspension emails: none for a customer without a profile, none for a lift of a user who was not suspended', async () => {
  await seedUser('aa-cust')
  clearOutbox()
  const until = new Date(Date.now() + 86_400_000).toISOString()
  expect((await adminCall(suspend.POST, 'aa-admin', 'POST', '/x', { until, reason: 'Spam' }, { id: 'aa-cust' })).status).toBe(200)
  expect(outboxForTests()).toEqual([])
  expect((await adminCall(suspend.POST, 'aa-admin', 'POST', '/x', { until: null, reason: '' }, { id: 'aa-cust' })).status).toBe(200)
  expect(outboxForTests()).toEqual([]) // the lift of a customer: nothing was hidden
  await seedUser('aa-notsus')
  await seedProvider('aa-notsus', { name: 'Not Suspended', categoryId })
  expect((await adminCall(suspend.POST, 'aa-admin', 'POST', '/x', { until: null, reason: '' }, { id: 'aa-notsus' })).status).toBe(200)
  expect(outboxForTests()).toEqual([])
})

it('a lift of a suspension that already ran out sends no "published again" email', async () => {
  await seedUser('aa-lapsed')
  await seedProvider('aa-lapsed', { name: 'Lapsed', categoryId })
  await pool.query("UPDATE users SET suspended_until = now() - interval '1 hour', suspended_reason = 'old' WHERE id = 'aa-lapsed'")
  clearOutbox()
  expect((await adminCall(suspend.POST, 'aa-admin', 'POST', '/x', { until: null, reason: '' }, { id: 'aa-lapsed' })).status).toBe(200)
  expect(outboxForTests()).toEqual([])
})

it('the end date in the suspension email is the Berlin date, whatever the server time zone', async () => {
  await seedUser('aa-tz')
  await seedProvider('aa-tz', { name: 'Zone', categoryId })
  clearOutbox()
  const zone = process.env.TZ
  process.env.TZ = 'Pacific/Auckland' // 22:30 UTC on 31 Dec is already 1 Jan there, but 23:30 on 31 Dec in Berlin
  try {
    expect((await adminCall(suspend.POST, 'aa-admin', 'POST', '/x', { until: '2099-12-31T22:30:00.000Z', reason: 'Spam' }, { id: 'aa-tz' })).status).toBe(200)
  } finally {
    if (zone === undefined) delete process.env.TZ
    else process.env.TZ = zone
  }
  expect(outboxForTests()[0]!.text).toContain('31.12.2099')
})

it('a user suspended before having a profile cannot create one and publish it (409)', async () => {
  await seedUser('aa-early', null, 'Early Bird')
  const until = new Date(Date.now() + 7 * 86_400_000).toISOString()
  expect((await adminCall(suspend.POST, 'aa-admin', 'POST', '/x', { until, reason: 'Fraud' }, { id: 'aa-early' })).status).toBe(200)
  expect((await call(profileRoute.PUT, 'aa-early', 'PUT', profile)).status).toBe(201)
  await givePhoto('aa-early')
  await call(services.POST, 'aa-early', 'POST', { categoryId, title: 'A', priceType: 'fixed', price: 10, currency: 'EUR' })
  const res = await call(publish.POST, 'aa-early', 'POST')
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'Profile suspended' })
  expect((await pool.query("SELECT status FROM providers WHERE owner_id = 'aa-early'")).rows[0].status).toBe('draft')
})

it('lists users with pagination and a text filter on email or name', async () => {
  for (const n of [1, 2, 3]) await seedUser(`aa-pg${n}`, null, n === 3 ? 'Zora Findme' : null)
  const q = (extra: object) => `?${new URLSearchParams({ filter: JSON.stringify({ q: 'aa-pg', ...extra }), pageSize: '2' })}`
  const p1 = await (await get('users', 'aa-rev', q({}))).json()
  expect([p1.total, p1.data.length]).toEqual([3, 2])
  const p2 = await (await get('users', 'aa-rev', `${q({})}&page=2`)).json()
  expect(p2.data.length).toBe(1)
  const one = await (await get('users', 'aa-rev', `?filter=${encodeURIComponent(JSON.stringify({ q: 'aa-pg2@' }))}`)).json()
  expect(one.total).toBe(1)
  expect(one.data[0].email).toBe(EMAIL('aa-pg2'))
  const byName = await (await get('users', 'aa-rev', `?filter=${encodeURIComponent(JSON.stringify({ q: 'findme' }))}`)).json()
  expect(byName.data.map((u: { id: string }) => u.id)).toEqual(['aa-pg3'])
  expect((await get('users', 'aa-rev', '?page=0')).status).toBe(400)
  expect((await get('users', 'aa-rev', '?filter=not-json')).status).toBe(400)
  const suspended = await (await get('users', 'aa-rev', `?filter=${encodeURIComponent('{"suspended":true}')}`)).json()
  expect(suspended.data.every((u: { suspendedUntil: string | null }) => u.suspendedUntil)).toBe(true)
})

it('creates and updates a category per language', async () => {
  const res = await adminCall(list.POST, 'aa-admin', 'POST', '/x', { slug: 'aa-cat', sort: 5, requiredDocuments: ['permit'], names: { de: 'Gartenarbeit', en: 'Gardening' } }, { resource: 'categories' })
  expect(res.status).toBe(201)
  const { data } = await res.json()
  expect(data).toMatchObject({ slug: 'aa-cat', sort: 5, requiredDocuments: ['permit'], names: { de: 'Gartenarbeit', en: 'Gardening' } })
  expect((await anon((tx) => listCategories(tx, 'en'))).find((c) => c.slug === 'aa-cat')?.name).toBe('Gardening')
  const upd = await adminCall(item.PATCH, 'aa-admin', 'PATCH', '/x', { names: { de: 'Garten', en: '' } }, { resource: 'categories', id: data.id })
  expect(upd.status).toBe(200)
  expect((await anon((tx) => listCategories(tx, 'de'))).find((c) => c.slug === 'aa-cat')?.name).toBe('Garten')
  expect((await get('categories', 'aa-admin', '', data.id).then((r) => r.json())).data.names).toEqual({ de: 'Garten', en: '' })
  expect((await adminCall(list.POST, 'aa-admin', 'POST', '/x', { slug: 'aa-cat', names: { de: 'Doppelt' } }, { resource: 'categories' })).status).toBe(409)
  expect((await adminCall(list.POST, 'aa-admin', 'POST', '/x', { slug: 'aa-bad', requiredDocuments: ['nope'], names: { de: 'X' } }, { resource: 'categories' })).status).toBe(400)
  expect((await adminCall(list.POST, 'aa-admin', 'POST', '/x', { slug: 'Bad Slug', names: { de: 'X' } }, { resource: 'categories' })).status).toBe(400)
})

it('creates a page and publishes it', async () => {
  const res = await adminCall(list.POST, 'aa-admin', 'POST', '/x', { slug: 'aa-page', kind: 'page', published: false, texts: { de: { title: 'Titel', body: '# Hallo' }, en: { title: '', body: '' } } }, { resource: 'pages' })
  expect(res.status).toBe(201)
  const { data } = await res.json()
  expect(await anon((tx) => getPage(tx, 'aa-page', 'de'))).toBeNull()
  const upd = await adminCall(item.PATCH, 'aa-admin', 'PATCH', '/x', { published: true }, { resource: 'pages', id: data.id })
  expect(upd.status).toBe(200)
  expect(await anon((tx) => getPage(tx, 'aa-page', 'de'))).toMatchObject({ title: 'Titel', bodyMarkdown: '# Hallo' })
  expect(await anon((tx) => getPage(tx, 'aa-page', 'en'))).toMatchObject({ title: 'Titel' }) // German fallback
  await adminCall(item.PATCH, 'aa-admin', 'PATCH', '/x', { texts: { de: { title: 'Neu', body: 'x' }, en: { title: 'New', body: 'y' } } }, { resource: 'pages', id: data.id })
  expect(await anon((tx) => getPage(tx, 'aa-page', 'en'))).toMatchObject({ title: 'New' })
  const read = (await get('pages', 'aa-admin', '', data.id).then((r) => r.json())).data
  expect(read).toMatchObject({ slug: 'aa-page', published: true, texts: { de: { title: 'Neu' }, en: { title: 'New' } } })
  expect((await adminCall(item.DELETE, 'aa-admin', 'DELETE', '/x', undefined, { resource: 'pages', id: data.id })).status).toBe(204)
})

it('sets a staff role by email; an unknown email is 404', async () => {
  await seedUser('aa-new')
  const set = (email: string, staffRole: string | null) => adminCall(list.PATCH, 'aa-admin', 'PATCH', '/x', { email, staffRole }, { resource: 'staff' })
  expect((await set(EMAIL('aa-new'), 'reviewer')).status).toBe(200)
  expect((await pool.query("SELECT staff_role FROM users WHERE id = 'aa-new'")).rows[0].staff_role).toBe('reviewer')
  const staff = await (await get('staff', 'aa-admin', '?pageSize=100')).json()
  expect(staff.data.some((u: { email: string }) => u.email === EMAIL('aa-new'))).toBe(true)
  expect((await set(EMAIL('aa-new'), null)).status).toBe(200)
  expect((await set('nobody@test.skilled.invalid', 'reviewer')).status).toBe(404)
  expect((await set(EMAIL('aa-new'), 'boss')).status).toBe(400)
})

it('providers are readable; a Reviewer deletes a photo (object removed, published profile photo unpublishes)', async () => {
  const photo = (await pool.query("INSERT INTO photos (owner_id, provider_id, kind, key, width, height) VALUES ('aa-owner', $1, 'portfolio', 'providers/aa/one.jpg', 1, 1) RETURNING id", [providerId])).rows[0].id
  store.objects.set('media/providers/aa/one.jpg', Buffer.from('x'))
  const list1 = await (await get('providers', 'aa-rev', `?filter=${encodeURIComponent('{"q":"Owner A"}')}`)).json()
  expect(list1.total).toBe(1)
  const shown = (await get('providers', 'aa-rev', '', providerId).then((r) => r.json())).data
  expect(shown.photos.map((p: { id: string }) => p.id)).toContain(photo)
  const del = await adminCall(item.DELETE, 'aa-rev', 'DELETE', '/x', undefined, { resource: 'photos', id: photo })
  expect(del.status).toBe(204)
  expect((await pool.query('SELECT 1 FROM photos WHERE id = $1', [photo])).rowCount).toBe(0)
  expect(store.objects.has('media/providers/aa/one.jpg')).toBe(false)
  expect((await adminCall(item.DELETE, 'aa-rev', 'DELETE', '/x', undefined, { resource: 'photos', id: photo })).status).toBe(404)
  const prof = (await pool.query("INSERT INTO photos (owner_id, kind, key, width, height) VALUES ('aa-owner', 'profile', 'users/aa/p.jpg', 1, 1) RETURNING id")).rows[0].id
  expect((await adminCall(item.DELETE, 'aa-rev', 'DELETE', '/x', undefined, { resource: 'photos', id: prof })).status).toBe(204)
  expect((await pool.query('SELECT status FROM providers WHERE id = $1', [providerId])).rows[0].status).toBe('draft')
})

it("staff see a person's picture on the provider page and the user page, and delete it", async () => {
  const pic = (await pool.query("INSERT INTO photos (owner_id, kind, key, width, height) VALUES ('aa-owner', 'profile', 'users/aa/q.jpg', 1, 1) RETURNING id")).rows[0].id
  const shown = (await get('providers', 'aa-rev', '', providerId).then((r) => r.json())).data
  expect(shown.photos.map((p: { id: string }) => p.id)).toContain(pic)
  expect((await (await get('users', 'aa-rev', '', 'aa-owner')).json()).data.photoId).toBe(pic)
  expect((await adminCall(item.DELETE, 'aa-rev', 'DELETE', '/x', undefined, { resource: 'photos', id: pic })).status).toBe(204)
  expect((await pool.query('SELECT 1 FROM photos WHERE id = $1', [pic])).rowCount).toBe(0)
  expect((await (await get('users', 'aa-rev', '', 'aa-owner')).json()).data.photoId).toBeNull()
})

it('GET /me returns the staff user; unknown resources are 404', async () => {
  const body = await (await adminCall(me.GET, 'aa-rev')).json()
  expect(body).toEqual({ id: 'aa-rev', email: EMAIL('aa-rev'), staffRole: 'reviewer' })
  expect((await get('nothing', 'aa-admin')).status).toBe(404)
})

it('a Reviewer cannot decide their own document', async () => {
  const id = await doc('aa-rev')
  const res = await adminCall(review.POST, 'aa-rev', 'POST', '/x', { decision: 'approved' }, { id })
  expect(res.status).toBe(403)
  const row = (await pool.query('SELECT status, reviewed_by FROM documents WHERE id = $1', [id])).rows[0]
  expect(row).toEqual({ status: 'pending', reviewed_by: null })
})

it('an expired suspension is not counted by the suspended filter', async () => {
  await seedUser('aa-exp')
  await pool.query("UPDATE users SET suspended_until = now() - interval '1 day', suspended_reason = 'old' WHERE id = 'aa-exp'")
  const body = await (await get('users', 'aa-rev', `?pageSize=100&filter=${encodeURIComponent('{"suspended":true}')}`)).json()
  expect(body.data.some((u: { id: string }) => u.id === 'aa-exp')).toBe(false)
  expect(body.data.every((u: { suspendedUntil: string }) => new Date(u.suspendedUntil) > new Date())).toBe(true)
})

it('GET users/[id] carries names, the private address and the picture; the list shows them too', async () => {
  await seedUser('aa-me1', null, 'Anna Schmidt')
  await pool.query("UPDATE users SET address_street = 'Hauptstr. 1', address_postcode = '10115', address_city = 'Berlin', address_country = 'DE' WHERE id = 'aa-me1'")
  await pool.query("INSERT INTO photos (owner_id, kind, key, width, height) VALUES ('aa-me1', 'profile', 'users/aa-me1/p.jpg', 1, 1)")
  const one = (await (await get('users', 'aa-rev', '', 'aa-me1')).json()).data
  expect(one).toMatchObject({ firstName: 'Anna', lastName: 'Schmidt', address: { street: 'Hauptstr. 1', postcode: '10115', city: 'Berlin', country: 'DE' }, photoUrl: 'https://media.test/users/aa-me1/p.jpg' })
  const listed = (await (await get('users', 'aa-rev', `?filter=${encodeURIComponent(JSON.stringify({ q: 'Anna Schm' }))}`)).json()).data
  expect(listed.map((u: { id: string }) => u.id)).toContain('aa-me1') // the name search works on "First Last"
}) 

it('GET users/[id] returns an address that has only a postcode', async () => {
  await seedUser('aa-pc', null, 'Paul Code')
  await pool.query("UPDATE users SET address_postcode = '10115', address_country = 'DE' WHERE id = 'aa-pc'")
  expect((await (await get('users', 'aa-rev', '', 'aa-pc')).json()).data.address).toEqual({ street: null, postcode: '10115', city: null, country: 'DE' })
})

it('suspension and published-again emails go to published profiles only; the cron still clears every ended suspension', async () => {
  const until = new Date(Date.now() + 86_400_000).toISOString()
  await seedProvider('aa-sdraft', { name: 'Draft Sus', categoryId, status: 'draft' })
  await seedProvider('aa-spub', { name: 'Pub Sus', categoryId })
  const suspendUser = (id: string, u: string | null) => adminCall(suspend.POST, 'aa-admin', 'POST', '/x', { until: u, reason: u ? 'Spam' : '' }, { id })
  clearOutbox()
  await suspendUser('aa-sdraft', until)
  expect(outboxForTests()).toEqual([])
  await suspendUser('aa-sdraft', null)
  expect(outboxForTests()).toEqual([])
  await suspendUser('aa-spub', until)
  expect(outboxForTests()).toHaveLength(1)
  await suspendUser('aa-spub', null)
  expect(outboxForTests()).toHaveLength(2)

  // the cron: both ended, only the published one is told
  await seedUser('aa-scust')
  for (const id of ['aa-sdraft', 'aa-spub', 'aa-scust']) {
    await pool.query("UPDATE users SET suspended_until = now() - interval '1 minute', suspended_reason = 'x' WHERE id = $1", [id])
    await pool.query("UPDATE providers SET suspended_until = now() - interval '1 minute' WHERE owner_id = $1", [id])
  }
  clearOutbox()
  const ended = await endExpiredSuspensions(db)
  expect(ended).toEqual(expect.arrayContaining(['aa-sdraft', 'aa-spub', 'aa-scust']))
  expect(outboxForTests()).toHaveLength(1)
  expect((await pool.query("SELECT count(*)::int AS n FROM users WHERE id LIKE 'aa-s%' AND suspended_until IS NOT NULL")).rows[0].n).toBe(0)
})
