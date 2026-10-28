import sharp from 'sharp'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { asUser, pool } from '@kando/db'
import { DocumentsListSchema, PhotoSchema } from '@kando/contract'
import { createAppRequest, deletePhoto, offerableServiceIds, setStorageForTests, storage } from '@kando/domain'
import { call, cleanupUsers, EMAIL, fakeSession, memoryStorage, profile, seedBase } from './helpers'

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
let categoryId: string
let docCategoryId: string
const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#c33' } }).png().toBuffer()
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
const USERS = ['rv1', 'rv2', 'rv3', 'rv4', 'rv5', 'rv6', 'rv7', 'rv8']

beforeAll(async () => {
  setStorageForTests(store)
  ;({ categoryId, docCategoryId } = await seedBase())
  for (const u of USERS) await call(profileRoute.PUT, u, 'PUT', profile)
  await pool.query("UPDATE users SET first_name = 'Rea', last_name = 'View' WHERE id = ANY($1)", [USERS])
})
afterAll(async () => {
  setStorageForTests(undefined)
  await cleanupUsers()
})
beforeEach(() => store.objects.clear())

type Route = (r: Request, c: { params: Promise<Record<string, string>> }) => Promise<Response>
function upload(handler: Route, uid: string, bytes: Buffer, fields: Record<string, string> = {}) {
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
const submit = (uid: string, requirement: string, document: string) => call(verifications.POST, uid, 'POST', { requirement, document })
const newFile = async (uid: string) => (await (await upload(files.POST, uid, PDF)).json()).id as string
const photoRows = async (uid: string) => (await pool.query('SELECT id, key FROM photos WHERE owner_id = $1', [uid])).rows
const withCookie = (uid: string, method = 'DELETE') =>
  new Request('http://localhost/x', { method, headers: { cookie: `uid=${uid}:${EMAIL(uid)}` } })
const none = { params: Promise.resolve({}) }

async function publishedUser(uid: string) {
  const id = (await (await sendPhoto(uid, 'profile')).json()).id as string
  await call(services.POST, uid, 'POST', { categoryId, title: 'A', priceType: 'fixed', price: 10, currency: 'EUR' })
  expect((await call(publish.POST, uid, 'POST')).status).toBe(200)
  return id
}

it('afterCommit: a handler that deletes a photo and then throws rolls back, the object stays', async () => {
  const id = (await (await sendPhoto('rv1', 'portfolio')).json()).id
  const before = keys('media')
  const route = createAppRequest(fakeSession)({ auth: 'required' }, async (ctx) => {
    await deletePhoto(ctx.tx, ctx.user!.id, id, (ctx as unknown as { afterCommit: never }).afterCommit)
    throw new Error('boom')
  })
  const res = await route(withCookie('rv1'), none)
  expect(res.status).toBe(500)
  expect(keys('media')).toEqual(before)
  expect(await photoRows('rv1')).toHaveLength(1)
})

it('afterCommit: the object is deleted only after the commit', async () => {
  const id = (await (await sendPhoto('rv1', 'portfolio')).json()).id
  const before = keys('media').length
  let inside = -1
  const route = createAppRequest(fakeSession)({ auth: 'required' }, async (ctx) => {
    await deletePhoto(ctx.tx, ctx.user!.id, id, (ctx as unknown as { afterCommit: never }).afterCommit)
    inside = keys('media').length
    return new Response(null, { status: 204 })
  })
  expect((await route(withCookie('rv1'), none)).status).toBe(204)
  expect(inside).toBe(before)
  expect(keys('media')).toHaveLength(before - 1)
})

it('private_files and documents are isolated (RLS)', async () => {
  const fid = await newFile('rv1')
  expect((await submit('rv1', 'permit', await newFile('rv1'))).status).toBe(201)
  const did = (await pool.query("SELECT id FROM documents WHERE owner_id = 'rv1' LIMIT 1")).rows[0].id
  for (const [table, id] of [['private_files', fid], ['documents', did]] as const) {
    const sel = await asUser('rv2', async (tx) => (await tx.execute(sql.raw(`SELECT 1 FROM ${table} WHERE id = '${id}'`))).rows)
    const del = await asUser('rv2', (tx) => tx.execute(sql.raw(`DELETE FROM ${table} WHERE id = '${id}'`)))
    expect(sel).toHaveLength(0)
    expect(del.rowCount).toBe(0)
    const anon = await asUser(null, async (tx) => (await tx.execute(sql.raw(`SELECT 1 FROM ${table}`))).rows)
    expect(anon).toHaveLength(0)
  }
  const updFile = await asUser('rv2', (tx) => tx.execute(sql`UPDATE private_files SET key = 'x' WHERE id = ${fid}`))
  const updDoc = await asUser('rv2', (tx) => tx.execute(sql`UPDATE documents SET requirement = 'police-certificate' WHERE id = ${did}`))
  expect([updFile.rowCount, updDoc.rowCount]).toEqual([0, 0])
  await expect(
    asUser('rv2', (tx) => tx.execute(sql`INSERT INTO private_files (owner_id, key) VALUES ('rv1', 'k')`)),
  ).rejects.toMatchObject({ cause: { message: expect.stringContaining('row-level security') } })
  expect((await pool.query('SELECT key FROM private_files WHERE id = $1', [fid])).rows[0].key).not.toBe('x')
})

it('at most 10 unsubmitted uploads per user (409)', async () => {
  for (let i = 0; i < 10; i++) expect((await upload(files.POST, 'rv3', PDF)).status).toBe(201)
  const res = await upload(files.POST, 'rv3', PDF)
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'Too many pending uploads' })
  expect(keys('documents')).toHaveLength(10)
})

it('a decompression bomb and a header followed by garbage are 400; a later upload is accepted', async () => {
  const bomb = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toBuffer()
  expect((await sendPhoto('rv4', 'portfolio', bomb)).status).toBe(400)
  const garbage = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('garbage garbage garbage')])
  expect((await sendPhoto('rv4', 'portfolio', garbage)).status).toBe(400)
  expect(keys('media')).toHaveLength(0)
  const ok = await sendPhoto('rv4', 'portfolio')
  expect(ok.status).toBe(201)
  PhotoSchema.parse(await ok.json())
})

it('EXIF is stripped from the stored JPEG', async () => {
  const withExif = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'secret-copyright' } })
    .toBuffer()
  expect((await sharp(withExif).metadata()).exif).toBeDefined()
  expect((await sendPhoto('rv4', 'portfolio', withExif)).status).toBe(201)
  const stored = [...store.objects.values()][0]!
  expect((await sharp(stored).metadata()).exif).toBeUndefined()
  expect(stored.includes(Buffer.from('secret-copyright'))).toBe(false)
})

it('alt over 200 characters is 400', async () => {
  const img = await png(10, 10)
  expect((await upload(photos.POST, 'rv4', img, { kind: 'portfolio', alt: 'x'.repeat(201) })).status).toBe(400)
  expect((await upload(photos.POST, 'rv4', img, { kind: 'portfolio', alt: 'x'.repeat(200) })).status).toBe(201)
})

it('an unauthenticated upload is refused before the body is read', async () => {
  let pulled = false
  const body = new ReadableStream(
    {
      pull() {
        pulled = true
        throw new Error('body read')
      },
    },
    { highWaterMark: 0 },
  )
  const res = await photos.POST(
    new Request('http://localhost/x', { method: 'POST', body, duplex: 'half', headers: { 'content-type': 'multipart/form-data; boundary=x' } } as RequestInit),
    none,
  )
  expect(res.status).toBe(401)
  expect(pulled).toBe(false)
})

it('the body is read before the first-contact user row and the transaction exist', async () => {
  // A brand-new user: ensureUser (which runs just before the transaction opens) creates the row.
  const known = async () => Number((await pool.query("SELECT count(*)::int AS n FROM users WHERE id = 'rv9'")).rows[0].n)
  let inPrepare = -1
  let inHandler = -1
  const route = createAppRequest(fakeSession)(
    {
      auth: 'required',
      prepare: async () => {
        inPrepare = await known()
      },
    },
    async () => {
      inHandler = await known()
      return new Response(null, { status: 204 })
    },
  )
  await route(withCookie('rv9', 'POST'), none)
  expect(inPrepare).toBe(0)
  expect(inHandler).toBe(1)
})

it('photos of a published provider are public, and unreadable once suspended', async () => {
  const photoId = await publishedUser('rv5')
  const read = () => asUser(null, async (tx) => (await tx.execute(sql`SELECT id FROM photos WHERE id = ${photoId}`)).rows)
  expect(await read()).toHaveLength(1)
  await pool.query("UPDATE providers SET suspended_until = now() + interval '1 day' WHERE owner_id = 'rv5'")
  expect(await read()).toHaveLength(0)
  await pool.query("UPDATE providers SET suspended_until = NULL WHERE owner_id = 'rv5'")
  expect(await read()).toHaveLength(1)
})

it('replacing the profile photo of a published profile works', async () => {
  const old = await publishedUser('rv6')
  const res = await sendPhoto('rv6', 'profile')
  expect(res.status).toBe(201)
  const fresh = (await res.json()).id
  expect(fresh).not.toBe(old)
  expect((await pool.query("SELECT status FROM providers WHERE owner_id = 'rv6'")).rows[0]).toEqual({ status: 'published' })
  expect((await photoRows('rv6'))[0]).toMatchObject({ id: fresh })
  expect(await photoRows('rv6')).toHaveLength(1)
  expect(keys('media')).toHaveLength(1)
})

it('deleting the profile photo while publishing never leaves a published profile without a photo', async () => {
  for (const uid of ['rv7', 'rv8']) {
    const id = (await (await sendPhoto(uid, 'profile')).json()).id
    await call(services.POST, uid, 'POST', { categoryId, title: 'A', priceType: 'fixed', price: 10, currency: 'EUR' })
    await Promise.all([call(photo.DELETE, uid, 'DELETE', undefined, { id }), call(publish.POST, uid, 'POST')])
    const row = (await pool.query("SELECT status, (SELECT count(*)::int FROM photos WHERE owner_id = $1 AND kind = 'profile') AS pics FROM providers WHERE owner_id = $1", [uid])).rows[0]
    expect(row.status === 'published' && row.pics === 0).toBe(false)
  }
})

it('two simultaneous submits for one requirement give one 201 and one 409', async () => {
  const [a, b] = [await newFile('rv2'), await newFile('rv2')]
  const res = await Promise.all([submit('rv2', 'permit', a), submit('rv2', 'permit', b)])
  expect(res.map((r) => r.status).sort()).toEqual([201, 409])
})

it('the database refuses a second pending check for a requirement', async () => {
  await expect(pool.query("INSERT INTO documents (owner_id, requirement, key) VALUES ('rv2', 'permit', 'dup')")).rejects.toThrow(/duplicate key/)
})

it('approval (staff SQL) makes a service with required documents offerable', async () => {
  const svc = (await (await call(services.POST, 'rv1', 'POST', { categoryId: docCategoryId, title: 'Kinder', priceType: 'fixed', price: 10, currency: 'EUR' })).json()).id
  const pid = (await pool.query("SELECT id FROM providers WHERE owner_id = 'rv1'")).rows[0].id
  // rv1's profile is a draft: only its owner gets an answer about it.
  const offerable = () => asUser('rv1', (tx) => offerableServiceIds(tx, pid))
  expect((await submit('rv1', 'police-certificate', await newFile('rv1'))).status).toBe(201)
  expect(await offerable()).not.toContain(svc)
  await pool.query("UPDATE documents SET status = 'approved', reviewed_by = 's', reviewed_at = now() WHERE owner_id = 'rv1' AND requirement = 'police-certificate'")
  expect(await offerable()).toContain(svc)
  const list = DocumentsListSchema.parse(await (await call(verifications.GET, 'rv1')).json())
  expect(list.docs.find((d) => d.requirement === 'police-certificate')).toMatchObject({ status: 'approved' })
  expect((await call(file.GET, 'rv1', 'GET', undefined, { id: list.docs[0]!.id })).status).toBe(200)
})

it('the signed link carries X-Amz-Expires=300 and an attachment disposition, and the public URL needs AWS_ENDPOINT', async () => {
  const saved = { ...process.env }
  Object.assign(process.env, { AWS_ENDPOINT: 'https://s3.example.test', AWS_REGION: 'eu-central-1', AWS_ACCESS_KEY_ID: 'k', AWS_SECRET_ACCESS_KEY: 's' })
  setStorageForTests(undefined)
  try {
    const link = await storage().getSignedUrl('documents', 'documents/u/x.pdf', 300)
    expect(link).toContain('X-Amz-Expires=300')
    expect(new URL(link).searchParams.get('response-content-disposition')).toBe('attachment')
    expect(storage().publicUrl('providers/p/x.jpg')).toMatch(/^https:\/\/s3\.example\.test\/[^/]+\/providers\/p\/x\.jpg$/)
    delete process.env.AWS_ENDPOINT
    setStorageForTests(undefined)
    expect(() => storage().publicUrl('k')).toThrow(/AWS_ENDPOINT/)
  } finally {
    process.env = saved
    setStorageForTests(store)
  }
})
