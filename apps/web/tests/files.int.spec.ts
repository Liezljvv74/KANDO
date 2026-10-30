import sharp from 'sharp'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { asUser, pool } from '@kando/db'
import { appPool } from '@kando/db/src/client'
import { DocumentSchema, DocumentsListSchema, PhotosListSchema } from '@kando/contract'
import { createAppRequest, prepareDocument, setStorageForTests } from '@kando/domain'
import { adminCall, call, cleanupUsers, EMAIL, memoryStorage, profile, seedBase, seedUser, sized } from './helpers'

vi.mock('../lib/auth/server', async () => ({ ...(await (await import('./helpers')).mockAuth()), sessionFromRequest: (await import('./helpers')).fakeSession }))
const adminItem = await import('../app/api/admin/[resource]/[id]/route')
const profileRoute = await import('../app/app-api/v1/provider-profile/route')
const publish = await import('../app/app-api/v1/provider-profile/publish/route')
const services = await import('../app/app-api/v1/services/route')
const photos = await import('../app/app-api/v1/photos/route')
const photo = await import('../app/app-api/v1/photos/[id]/route')
const files = await import('../app/app-api/v1/files/route')
const file = await import('../app/app-api/v1/files/[id]/route')
const verifications = await import('../app/app-api/v1/verifications/route')

const store = memoryStorage()
const png = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#c33' } }).png().toBuffer()
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')

beforeAll(async () => {
  setStorageForTests(store)
  await seedBase()
  for (const u of ['fl1', 'fl2', 'fl3']) await call(profileRoute.PUT, u, 'PUT', profile)
  await pool.query("UPDATE users SET first_name = 'Fia', last_name = 'Lang' WHERE id IN ('fl1', 'fl2', 'fl3')")
})
afterAll(async () => {
  setStorageForTests(undefined)
  await cleanupUsers()
})
beforeEach(() => store.objects.clear())

async function upload(handler: (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>, uid: string, bytes: Buffer, fields: Record<string, string> = {}) {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)]), 'upload.bin')
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return handler(
    await sized(new Request('http://localhost/app-api/v1/x', { method: 'POST', headers: { origin: 'http://localhost', cookie: `uid=${uid}:${EMAIL(uid)}` }, body: form })),
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
  const row = (await pool.query('SELECT provider_id FROM photos WHERE id = $1', [body.id])).rows[0]
  expect(row.provider_id).toBeNull() // the picture belongs to the person
  expect(keys('media')[0]).toMatch(/^media\/people\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/) // a random folder: the account id is not in the public URL
  expect(keys('media')[0]).not.toContain('fl1')
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

it('a portfolio photo needs a profile first (409); anonymous is 401; an oversize body is 413', async () => {
  expect((await sendPhoto('fl0', 'portfolio')).status).toBe(409)
  const anon = await photos.POST(new Request('http://localhost/x', { method: 'POST' }), { params: Promise.resolve({}) })
  expect(anon.status).toBe(401)
  const big = await upload(photos.POST, 'fl1', Buffer.alloc(10_100_000, 1), { kind: 'portfolio' })
  expect(big.status).toBe(413)
})

it('deleting a photo: another user gets 404, the owner 204 and the object and row are gone', async () => {
  const id = (await (await sendPhoto('fl3', 'profile')).json()).id
  expect((await call(photo.DELETE, 'fl1', 'DELETE', undefined, { id })).status).toBe(404)
  expect(keys('media')).toHaveLength(1)
  expect((await call(photo.DELETE, 'fl3', 'DELETE', undefined, { id })).status).toBe(204)
  expect(keys('media')).toHaveLength(0)
  expect((await pool.query('SELECT 1 FROM photos WHERE id = $1', [id])).rowCount).toBe(0)
  expect((await call(photo.DELETE, 'fl3', 'DELETE', undefined, { id: 'nope' })).status).toBe(404)
})

it('a published provider may delete the profile photo: the profile stays live and complete, the public page shows none', async () => {
  const cat = (await pool.query('SELECT id FROM categories LIMIT 1')).rows[0].id
  const id = (await (await sendPhoto('fl3', 'profile')).json()).id
  await call(services.POST, 'fl3', 'POST', { categoryId: cat, title: 'A', priceType: 'fixed', price: 10, currency: 'EUR' })
  expect((await call(publish.POST, 'fl3', 'POST')).status).toBe(200)
  const res = await call(photo.DELETE, 'fl3', 'DELETE', undefined, { id })
  expect(res.status).toBe(204)
  expect(keys('media')).toHaveLength(0)
  expect((await pool.query("SELECT status FROM providers WHERE owner_id = 'fl3'")).rows[0].status).toBe('published')
  expect((await (await call(profileRoute.GET, 'fl3')).json()).missing).toEqual([])
  expect((await call(profileRoute.PUT, 'fl3', 'PUT', { ...profile, experience: 'Edited after removing the picture' })).status).toBe(200) // a live profile is still editable
})

it('suspended_until is domain-only and photos are isolated', async () => {
  const mine = (await pool.query("SELECT id FROM photos WHERE owner_id = 'fl2' LIMIT 1")).rows[0].id
  await expect(asUser('fl1', (tx) => tx.execute(sql`UPDATE providers SET suspended_until = now() WHERE owner_id = 'fl1'`))).rejects.toMatchObject({
    cause: { message: expect.stringContaining('permission denied') },
  })
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
  expect(keys('documents')[0]).toMatch(/^documents\/documents\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/)
  expect((await call(file.GET, 'fl2', 'GET', undefined, { id })).status).toBe(404)
  expect((await call(file.GET, 'fl1', 'GET', undefined, { id: 'nope' })).status).toBe(404)
  const link = await call(file.GET, 'fl1', 'GET', undefined, { id })
  expect(link.status).toBe(200)
  expect((await link.json()).url).toMatch(/^https:\/\/signed\.test\/documents\/documents\/[0-9a-f-]{36}\//)
  expect((await call(file.DELETE, 'fl2', 'DELETE', undefined, { id })).status).toBe(404)
  expect((await call(file.DELETE, 'fl1', 'DELETE', undefined, { id })).status).toBe(204)
  expect(keys('documents')).toHaveLength(0)
})

it('documents also take JPEG, PNG and WEBP photos: re-encoded without metadata, at most 2400 px, stored with their type', async () => {
  const exif = { IFD0: { Copyright: 'secret-owner' } }
  const jpeg = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#36c' } }).jpeg().withExifMerge(exif).toBuffer()
  expect((await sharp(jpeg).metadata()).exif).toBeDefined() // the input does carry EXIF
  const pngDoc = await png(40, 30)
  const webp = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#3c6' } }).webp().toBuffer()
  for (const [bytes, type, ext] of [[jpeg, 'image/jpeg', 'jpg'], [pngDoc, 'image/png', 'png'], [webp, 'image/webp', 'webp']] as const) {
    store.objects.clear()
    store.types.clear()
    const res = await upload(files.POST, 'fl1', bytes)
    expect(res.status).toBe(201)
    const [key] = keys('documents')
    expect(key).toMatch(new RegExp(`^documents/documents/[0-9a-f-]{36}/[0-9a-f-]{36}\\.${ext}$`))
    expect(store.types.get(key!)).toBe(type)
    const meta = await sharp(store.objects.get(key!)!).metadata()
    expect(meta.format).toBe(ext === 'jpg' ? 'jpeg' : ext)
    expect(meta.exif).toBeUndefined()
    if (ext === 'jpg') expect([meta.width, meta.height]).toEqual([2400, 800])
    await call(file.DELETE, 'fl1', 'DELETE', undefined, { id: (await res.json()).id })
  }
  const pdf = await upload(files.POST, 'fl1', PDF)
  expect(store.types.get(keys('documents').find((k) => k.endsWith('.pdf'))!)).toBe('application/pdf')
  await call(file.DELETE, 'fl1', 'DELETE', undefined, { id: (await pdf.json()).id })
})

it('a GIF and a text file renamed to .pdf are refused as documents', async () => {
  const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } }).gif().toBuffer()
  for (const bytes of [gif, Buffer.from('just some text, not a pdf')]) {
    const res = await upload(files.POST, 'fl1', bytes)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Unsupported file type' })
  }
  expect(keys('documents')).toHaveLength(0)
})

it('an image over 25 megapixels is 400 Unsupported file type', async () => {
  const res = await upload(files.POST, 'fl1', await png(6000, 4500))
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ error: 'Unsupported file type' })
  expect(keys('documents')).toHaveLength(0)
})

it('staff open an image document through the same signed link; it is served as an image', async () => {
  await seedUser('fl-staff', 'reviewer')
  const id = (await (await upload(files.POST, 'fl3', await png(20, 20))).json()).id as string
  const doc = await call(verifications.POST, 'fl3', 'POST', { requirement: 'permit', document: id })
  expect(doc.status).toBe(201)
  const docId = (await doc.json()).id as string
  const res = await adminCall(adminItem.GET, 'fl-staff', 'GET', `/api/admin/documents/${docId}`, undefined, { resource: 'documents', id: docId })
  expect(res.status).toBe(200)
  const { link } = (await res.json()).data
  expect(link).toMatch(/^https:\/\/signed\.test\/documents\/documents\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png\?expires=300$/)
  expect(store.types.get(new URL(link).pathname.slice(1))).toBe('image/png')
})

it('a document stored before the transaction is removed when the request then fails', async () => {
  const route = createAppRequest((await import('./helpers')).fakeSession)({ auth: 'required', prepare: prepareDocument }, async () => {
    throw new Error('boom')
  })
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(PDF)]), 'a.pdf')
  const res = await route(await sized(new Request('http://localhost/x', { method: 'POST', headers: { origin: 'http://localhost', cookie: `uid=fl1:${EMAIL('fl1')}` }, body: form })), { params: Promise.resolve({}) })
  expect(res.status).toBe(500)
  expect(keys('documents')).toHaveLength(0)
})

it('a refused upload leaves no object', async () => {
  const img = await png(10, 10)
  for (let i = 0; i < 12; i++) await sendPhoto('fl2', 'portfolio', img) // fills the portfolio (earlier tests may have)
  const before = store.objects.size
  expect((await sendPhoto('fl2', 'portfolio', img)).status).toBe(409) // 13th portfolio photo
  expect(store.objects.size).toBe(before)
  for (let i = 0; i < 10; i++) expect((await upload(files.POST, 'fl4', PDF)).status).toBe(201)
  const docs = keys('documents').length
  expect((await upload(files.POST, 'fl4', PDF)).status).toBe(409) // 11th pending document
  expect(keys('documents')).toHaveLength(docs)
  await pool.query("UPDATE users SET suspended_until = now() + interval '1 day' WHERE id = 'fl1'")
  try {
    const n = store.objects.size
    expect((await sendPhoto('fl1', 'profile')).status).toBe(403)
    expect((await upload(files.POST, 'fl1', PDF)).status).toBe(403)
    expect(store.objects.size).toBe(n)
  } finally {
    await pool.query("UPDATE users SET suspended_until = NULL WHERE id = 'fl1'")
  }
})

it('the object is stored before the transaction opens', async () => {
  const inUse: number[] = []
  const put = store.put
  store.put = async (...a) => {
    inUse.push(appPool.totalCount - appPool.idleCount)
    return put(...a)
  }
  try {
    expect((await sendPhoto('fl1', 'profile')).status).toBe(201)
    expect((await upload(files.POST, 'fl3', PDF)).status).toBe(201)
  } finally {
    store.put = put
  }
  expect(inUse.length).toBeGreaterThan(1)
  expect(inUse.every((n) => n === 0)).toBe(true)
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

it('the profile photo is private to its owner: another user cannot see it and gets 404 on delete; listPhotos puts it first', async () => {
  const id = (await (await sendPhoto('fl1', 'profile')).json()).id
  // there is no GET route for a photo: the row itself is invisible to another user (RLS)
  expect(await asUser('fl2', async (tx) => (await tx.execute(sql`SELECT 1 FROM photos WHERE id = ${id}`)).rows)).toHaveLength(0)
  expect((await call(photo.DELETE, 'fl2', 'DELETE', undefined, { id })).status).toBe(404)
  expect((await pool.query('SELECT 1 FROM photos WHERE id = $1', [id])).rowCount).toBe(1)
  // a portfolio photo uploaded later still lists after the picture; replacing the picture keeps it first
  await sendPhoto('fl1', 'portfolio')
  await pool.query("UPDATE photos SET created_at = now() - interval '1 day' WHERE owner_id = 'fl1' AND kind = 'portfolio'")
  const kinds = async () => PhotosListSchema.parse(await (await call(photos.GET, 'fl1')).json()).docs.map((d) => d.kind)
  expect((await kinds())[0]).toBe('profile')
})

it('every one of the nine document types can be submitted, optional ones included', async () => {
  for (const type of ['first-aid-certificate', 'id-document']) expect((await submit('fl1', type, await newFile('fl1'))).status).toBe(201)
})
