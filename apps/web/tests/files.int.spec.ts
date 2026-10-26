import sharp from 'sharp'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { asUser, pool } from '@kando/db'
import { DocumentSchema, DocumentsListSchema, PhotosListSchema } from '@kando/contract'
import { offerableServiceIds, setStorageForTests, uploadFile } from '@kando/domain'
import { call, cleanupUsers, EMAIL, memoryStorage, profile, seedBase } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const profileRoute = await import('../app/app-api/v1/provider-profile/route')
const publish = await import('../app/app-api/v1/provider-profile/publish/route')
const services = await import('../app/app-api/v1/services/route')
const photos = await import('../app/app-api/v1/photos/route')
const photo = await import('../app/app-api/v1/photos/[id]/route')
const files = await import('../app/app-api/v1/files/route')
const file = await import('../app/app-api/v1/files/[id]/route')
const verifications = await import('../app/app-api/v1/verifications/route')

const store = memoryStorage()
let docCategoryId: string
const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#c33' } }).png().toBuffer()
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')

beforeAll(async () => {
  setStorageForTests(store)
  ;({ docCategoryId } = await seedBase())
  for (const u of ['fl1', 'fl2', 'fl3']) await call(profileRoute.PUT, u, 'PUT', profile)
})
afterAll(async () => {
  setStorageForTests(undefined)
  await cleanupUsers()
})
beforeEach(() => store.objects.clear())

function upload(handler: (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>, uid: string, bytes: Buffer, fields: Record<string, string> = {}) {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)]), 'upload.bin')
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return handler(
    new Request('http://localhost/app-api/v1/x', { method: 'POST', headers: { cookie: `uid=${uid}:${EMAIL(uid)}` }, body: form }),
    { params: Promise.resolve({}) },
  )
}
const sendPhoto = async (uid: string, kind: string, bytes?: Buffer) => upload(photos.POST, uid, bytes ?? (await png(64, 48)), { kind })
const keys = (bucket: string) => [...store.objects.keys()].filter((k) => k.startsWith(`${bucket}/`))

it('a profile photo is re-encoded to JPEG at most 1600 px and returned in contract shape', async () => {
  const res = await sendPhoto('fl1', 'profile', await png(3200, 1600))
  expect(res.status).toBe(201)
  const body = await res.json()
  expect(body).toMatchObject({ kind: 'profile', width: 1600, height: 800 })
  expect(body.url).toBe(`https://media.test/${[...store.objects.keys()][0]!.replace('media/', '')}`)
  const stored = [...store.objects.values()][0]!
  expect((await sharp(stored).metadata()).format).toBe('jpeg')
  const list = PhotosListSchema.parse(await (await call(photos.GET, 'fl1')).json())
  expect(list.docs.map((d) => d.id)).toEqual([body.id])
  const p = await pool.query("SELECT photo_id, id FROM providers WHERE owner_id = 'fl1'")
  expect(p.rows[0].photo_id).toBe(body.id)
  expect(keys('media')[0]).toMatch(new RegExp(`^media/providers/${p.rows[0].id}/[0-9a-f-]{36}\\.jpg$`))
})

it('a new profile photo replaces the old one and deletes its object', async () => {
  await sendPhoto('fl1', 'profile')
  const before = keys('media')
  const res = await sendPhoto('fl1', 'profile')
  expect(res.status).toBe(201)
  expect(keys('media')).toHaveLength(1)
  expect(keys('media')[0]).not.toBe(before[0])
  const n = await pool.query("SELECT count(*)::int AS n FROM photos WHERE owner_id = 'fl1' AND kind = 'profile'")
  expect(n.rows[0].n).toBe(1)
})

it('portfolio is limited to 12 (409), a non-image is 400, a missing kind is 400', async () => {
  const img = await png(10, 10)
  for (let i = 0; i < 12; i++) expect((await sendPhoto('fl2', 'portfolio', img)).status).toBe(201)
  const over = await sendPhoto('fl2', 'portfolio', img)
  expect(over.status).toBe(409)
  expect(await over.json()).toEqual({ error: 'Photo limit reached' })
  expect(keys('media')).toHaveLength(12) // the refused upload left no object
  expect((await sendPhoto('fl2', 'portfolio', Buffer.from('not an image'))).status).toBe(400)
  expect((await upload(photos.POST, 'fl2', img, {})).status).toBe(400)
  expect((await upload(photos.POST, 'fl2', img, { kind: 'banner' })).status).toBe(400)
})

it('a photo needs a profile first (409); anonymous is 401; an oversize body is 413', async () => {
  expect((await sendPhoto('fl0', 'profile')).status).toBe(409)
  const anon = await photos.POST(new Request('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({}) })
  expect(anon.status).toBe(401)
  const big = await upload(photos.POST, 'fl1', Buffer.alloc(10_100_000, 1), { kind: 'portfolio' })
  expect(big.status).toBe(413)
})

it('deleting a photo: another user gets 404, the owner 204 and the object is gone; the profile photo is cleared', async () => {
  const id = (await (await sendPhoto('fl3', 'profile')).json()).id
  expect((await call(photo.DELETE, 'fl1', 'DELETE', undefined, { id })).status).toBe(404)
  expect(keys('media')).toHaveLength(1)
  expect((await call(photo.DELETE, 'fl3', 'DELETE', undefined, { id })).status).toBe(204)
  expect(keys('media')).toHaveLength(0)
  expect((await pool.query("SELECT photo_id FROM providers WHERE owner_id = 'fl3'")).rows[0].photo_id).toBeNull()
  expect((await call(photo.DELETE, 'fl3', 'DELETE', undefined, { id: 'nope' })).status).toBe(404)
})

it('the profile photo of a published profile cannot be deleted (409)', async () => {
  const cat = (await pool.query('SELECT id FROM categories LIMIT 1')).rows[0].id
  const id = (await (await sendPhoto('fl3', 'profile')).json()).id
  await call(services.POST, 'fl3', 'POST', { categoryId: cat, title: 'A', priceType: 'fixed', price: 10, currency: 'EUR' })
  expect((await call(publish.POST, 'fl3', 'POST')).status).toBe(200)
  const res = await call(photo.DELETE, 'fl3', 'DELETE', undefined, { id })
  expect(res.status).toBe(409)
  expect(keys('media')).toHaveLength(1)
})

it('photo_id is domain-only and photos are isolated', async () => {
  const mine = (await pool.query("SELECT id FROM photos WHERE owner_id = 'fl2' LIMIT 1")).rows[0].id
  await expect(asUser('fl1', (tx) => tx.execute(sql`UPDATE providers SET photo_id = ${mine} WHERE owner_id = 'fl1'`))).rejects.toMatchObject({
    cause: { message: expect.stringContaining('permission denied') },
  })
  // set_provider_photo refuses a photo of someone else
  const r = await asUser('fl1', async (tx) => (await tx.execute(sql`SELECT set_provider_photo(${mine}::uuid) AS ok`)).rows[0])
  expect(r).toEqual({ ok: false })
  // fl1 cannot insert a photo for fl2's provider, nor change or delete fl2's photos
  const fl2p = (await pool.query("SELECT id FROM providers WHERE owner_id = 'fl2'")).rows[0].id
  await expect(
    asUser('fl1', (tx) =>
      tx.execute(sql`INSERT INTO photos (owner_id, provider_id, kind, key, width, height) VALUES ('fl1', ${fl2p}, 'portfolio', 'k', 1, 1)`),
    ),
  ).rejects.toMatchObject({ cause: { message: expect.stringContaining('row-level security') } })
  const upd = await asUser('fl1', (tx) => tx.execute(sql`UPDATE photos SET alt = 'x' WHERE id = ${mine}`))
  const del = await asUser('fl1', (tx) => tx.execute(sql`DELETE FROM photos WHERE id = ${mine}`))
  expect([upd.rowCount, del.rowCount]).toEqual([0, 0])
  // an unpublished provider's photos are not public
  const anon = await asUser(null, async (tx) => (await tx.execute(sql`SELECT 1 FROM photos WHERE id = ${mine}`)).rows)
  expect(anon).toHaveLength(0)
})

it('files: a PDF goes to the private bucket, a non-PDF is 400, another user gets 404, the owner a signed link', async () => {
  expect((await upload(files.POST, 'fl1', Buffer.from('GIF89a....'))).status).toBe(400)
  expect((await upload(files.POST, 'fl1', Buffer.alloc(4_600_000, 1))).status).toBe(413)
  const res = await upload(files.POST, 'fl1', PDF)
  expect(res.status).toBe(201)
  const { id } = await res.json()
  expect(keys('documents')[0]).toMatch(/^documents\/documents\/fl1\/[0-9a-f-]{36}\.pdf$/)
  expect((await call(file.GET, 'fl2', 'GET', undefined, { id })).status).toBe(404)
  expect((await call(file.GET, 'fl1', 'GET', undefined, { id: 'nope' })).status).toBe(404)
  const link = await call(file.GET, 'fl1', 'GET', undefined, { id })
  expect(link.status).toBe(200)
  expect((await link.json()).url).toContain('https://signed.test/documents/documents/fl1/')
  expect((await call(file.DELETE, 'fl2', 'DELETE', undefined, { id })).status).toBe(404)
  expect((await call(file.DELETE, 'fl1', 'DELETE', undefined, { id })).status).toBe(204)
  expect(keys('documents')).toHaveLength(0)
})

it('a failed file insert removes the uploaded object', async () => {
  await expect(asUser('fl1', (tx) => uploadFile(tx, 'someone-else', PDF))).rejects.toThrow()
  expect(keys('documents')).toHaveLength(0)
})

const submit = (uid: string, requirement: string, document: string) => call(verifications.POST, uid, 'POST', { requirement, document })
const newFile = async (uid: string) => (await (await upload(files.POST, uid, PDF)).json()).id as string

it('verifications: one pending check per requirement (409 removes the second file), bad input is 400', async () => {
  const first = await newFile('fl1')
  const ok = await submit('fl1', 'police-certificate', first)
  expect(ok.status).toBe(201)
  expect(DocumentSchema.parse(await ok.json())).toMatchObject({ requirement: 'police-certificate', status: 'pending', note: null })
  const second = await newFile('fl1')
  expect(keys('documents')).toHaveLength(2)
  const dup = await submit('fl1', 'police-certificate', second)
  expect(dup.status).toBe(409)
  expect(await dup.json()).toEqual({ error: 'Check already pending' })
  expect(keys('documents')).toHaveLength(1)
  expect((await submit('fl1', 'permit', second)).status).toBe(400) // the second file is gone
  expect((await submit('fl1', 'driving-licence', await newFile('fl1'))).status).toBe(400)
  expect((await submit('fl2', 'permit', first)).status).toBe(400) // not fl2's file
  const list = DocumentsListSchema.parse(await (await call(verifications.GET, 'fl1')).json())
  expect(list.docs).toHaveLength(1)
  expect(list.docs[0]!.requirement).toBe('police-certificate')
  expect(DocumentsListSchema.parse(await (await call(verifications.GET, 'fl2')).json()).docs).toEqual([])
  // the submitted file stays reachable through the document id
  expect((await call(file.GET, 'fl1', 'GET', undefined, { id: list.docs[0]!.id })).status).toBe(200)
})

it('approving the document (staff, direct SQL) makes the service offerable', async () => {
  const svc = (await (await call(services.POST, 'fl1', 'POST', { categoryId: docCategoryId, title: 'Kinder', priceType: 'fixed', price: 10, currency: 'EUR' })).json()).id
  const pid = (await pool.query("SELECT id FROM providers WHERE owner_id = 'fl1'")).rows[0].id
  const { db } = await import('@kando/db')
  expect(await offerableServiceIds(db, pid)).not.toContain(svc)
  await pool.query("UPDATE documents SET status = 'approved', reviewed_by = 'staff1', reviewed_at = now() WHERE owner_id = 'fl1' AND requirement = 'police-certificate'")
  expect(await offerableServiceIds(db, pid)).toContain(svc)
  const list = DocumentsListSchema.parse(await (await call(verifications.GET, 'fl1')).json())
  expect(list.docs[0]).toMatchObject({ status: 'approved' })
  expect(list.docs[0]!.reviewedAt).not.toBeNull()
})
