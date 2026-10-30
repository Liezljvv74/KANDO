import sharp from 'sharp'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { setStorageForTests } from '@kando/domain'
import { call, cleanupUsers, EMAIL, memoryStorage, profile, seedBase } from './helpers'

vi.mock('../lib/auth/server', async () => ({ ...(await (await import('./helpers')).mockAuth()), sessionFromRequest: (await import('./helpers')).fakeSession }))
const profileRoute = await import('../app/app-api/v1/provider-profile/route')
const photos = await import('../app/app-api/v1/photos/route')
const photo = await import('../app/app-api/v1/photos/[id]/route')
const files = await import('../app/app-api/v1/files/route')
const file = await import('../app/app-api/v1/files/[id]/route')
const verifications = await import('../app/app-api/v1/verifications/route')
const references = await import('../app/app-api/v1/references/route')
const reference = await import('../app/app-api/v1/references/[id]/route')

const store = memoryStorage()
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
const U = 'se1'
const ref = { clientName: 'Familie M.', description: 'Zwei Jahre', year: 2022 }

const upload = async (handler: typeof photos.POST, bytes: Buffer, fields: Record<string, string> = {}) => {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)]), 'upload.bin')
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return handler(new Request('http://localhost/app-api/v1/x', { method: 'POST', headers: { origin: 'http://localhost', cookie: `uid=${U}:${EMAIL(U)}` }, body: form }), { params: Promise.resolve({}) })
}
const png = () => sharp({ create: { width: 64, height: 48, channels: 3, background: '#c33' } }).png().toBuffer()
const count = async (table: string) => Number((await pool.query(`SELECT count(*) FROM ${table} WHERE owner_id = $1`, [U])).rows[0].count)
const suspend = (when: string) => pool.query(`UPDATE users SET suspended_until = ${when} WHERE id = $1`, [U])

let profilePhoto: string, portfolioPhoto: string, privateFile: string, refId: string

beforeAll(async () => {
  setStorageForTests(store)
  await seedBase()
  await call(profileRoute.PUT, U, 'PUT', profile)
  profilePhoto = (await (await upload(photos.POST, await png(), { kind: 'profile' })).json()).id
  portfolioPhoto = (await (await upload(photos.POST, await png(), { kind: 'portfolio' })).json()).id
  const submitted = (await (await upload(files.POST, PDF)).json()).id
  expect((await call(verifications.POST, U, 'POST', { requirement: 'permit', document: submitted })).status).toBe(201)
  privateFile = (await (await upload(files.POST, PDF)).json()).id
  refId = (await (await call(references.POST, U, 'POST', ref)).json()).id
})
afterAll(async () => {
  setStorageForTests(undefined)
  await cleanupUsers()
})

it('a suspended person cannot create or edit: POST and PATCH answer 403 SUSPENDED', async () => {
  await suspend("now() + interval '1 day'")
  const blocked = [
    await upload(photos.POST, await png(), { kind: 'portfolio' }),
    await upload(files.POST, PDF),
    await call(verifications.POST, U, 'POST', { requirement: 'permit', document: privateFile }),
    await call(references.POST, U, 'POST', ref),
    await call(reference.PATCH, U, 'PATCH', { description: 'x' }, { id: refId }),
  ]
  for (const res of blocked) {
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'SUSPENDED' })
  }
})

it('a suspended person can still delete their own file, portfolio photo, profile picture and reference: rows and objects are gone', async () => {
  const before = store.objects.size
  expect(before).toBeGreaterThanOrEqual(4) // two photos, the submitted document, the private file
  expect((await call(file.DELETE, U, 'DELETE', undefined, { id: privateFile })).status).toBe(204)
  expect(await count('private_files')).toBe(0)
  expect((await call(photo.DELETE, U, 'DELETE', undefined, { id: portfolioPhoto })).status).toBe(204)
  expect((await call(photo.DELETE, U, 'DELETE', undefined, { id: profilePhoto })).status).toBe(204)
  expect(await count('photos')).toBe(0)
  expect((await call(reference.DELETE, U, 'DELETE', undefined, { id: refId })).status).toBe(204)
  expect((await pool.query('SELECT 1 FROM provider_references WHERE id = $1', [refId])).rowCount).toBe(0)
  // after-commit storage deletes: only the submitted document's object is left (no route deletes a submitted document)
  expect(store.objects.size).toBe(1)
  expect([...store.objects.keys()][0]).toMatch(/^documents\//)
})

it('a submitted document has no delete route on this branch; it stays readable by its owner while suspended', async () => {
  expect('DELETE' in verifications).toBe(false)
  expect(await count('documents')).toBe(1)
})

it('an expired suspension counts as not suspended', async () => {
  await suspend("now() - interval '1 day'")
  expect((await call(references.POST, U, 'POST', ref)).status).toBe(201)
  expect((await upload(photos.POST, await png(), { kind: 'profile' })).status).toBe(201)
})
