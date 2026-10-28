import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { db, pool } from '@kando/db'
import { offerableServiceIds, setStorageForTests } from '@kando/domain'
import { call, cleanupUsers, memoryStorage, seedBase, seedProvider } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const verification = await import('../app/app-api/v1/verifications/[id]/route')

const store = memoryStorage()
let docCategoryId: string
let providerId: string

beforeAll(async () => {
  setStorageForTests(store)
  ;({ docCategoryId } = await seedBase())
  providerId = await seedProvider('dr1', { name: 'Doc One', categoryId: docCategoryId })
  await seedProvider('dr2', { name: 'Doc Two', categoryId: docCategoryId })
})
afterAll(async () => {
  setStorageForTests(undefined)
  await pool.query('DELETE FROM pending_object_deletes')
  await cleanupUsers()
})
beforeEach(async () => {
  store.objects.clear()
  await pool.query("DELETE FROM documents WHERE owner_id IN ('dr1', 'dr2')")
})

/** A submitted document with its object in the private bucket; returns its id. */
async function doc(uid: string, status: string, requirement = 'police-certificate') {
  const key = `documents/${uid}/${crypto.randomUUID()}.pdf`
  store.objects.set(`documents/${key}`, Buffer.from('x'))
  return (await pool.query('INSERT INTO documents (owner_id, requirement, key, status) VALUES ($1, $2, $3, $4) RETURNING id', [uid, requirement, key, status])).rows[0].id as string
}
const del = (uid: string, id: string) => call(verification.DELETE, uid, 'DELETE', undefined, { id })
const rows = async (uid: string) => Number((await pool.query('SELECT count(*) n FROM documents WHERE owner_id = $1', [uid])).rows[0].n)

it('without a replacement it is 409 REPLACEMENT_FIRST and the row and object stay', async () => {
  const id = await doc('dr1', 'rejected')
  const res = await del('dr1', id)
  expect(res.status).toBe(409)
  expect(await res.json()).toEqual({ error: 'REPLACEMENT_FIRST' })
  expect(await rows('dr1')).toBe(1)
  expect(store.objects.size).toBe(1)
  // A document for another requirement is no replacement.
  await doc('dr1', 'pending', 'permit')
  expect((await del('dr1', id)).status).toBe(409)
})

it('with a replacement (any status) it is 204: row and object are gone, nothing is left owed', async () => {
  const old = await doc('dr1', 'rejected')
  await doc('dr1', 'pending')
  expect((await del('dr1', old)).status).toBe(204)
  expect(await rows('dr1')).toBe(1)
  expect(store.objects.size).toBe(1)
  expect(Number((await pool.query('SELECT count(*) n FROM pending_object_deletes')).rows[0].n)).toBe(0)
  // The replacement is now the only one: it cannot be deleted.
  const last = (await pool.query("SELECT id FROM documents WHERE owner_id = 'dr1'")).rows[0].id
  expect((await del('dr1', last)).status).toBe(409)
})

it('another person document is 404 and untouched; a bad id is 404', async () => {
  const mine = await doc('dr2', 'approved')
  await doc('dr2', 'pending')
  expect((await del('dr1', mine)).status).toBe(404)
  expect((await del('dr1', 'not-a-uuid')).status).toBe(404)
  expect(await rows('dr2')).toBe(2)
})

it('deleting the approved document while the replacement is pending takes the service offline until the replacement is approved', async () => {
  const approved = await doc('dr1', 'approved')
  const replacement = await doc('dr1', 'pending')
  expect(await offerableServiceIds(db, providerId)).toHaveLength(1)
  expect((await del('dr1', approved)).status).toBe(204)
  expect(await offerableServiceIds(db, providerId)).toEqual([])
  await pool.query("UPDATE documents SET status = 'approved', reviewed_at = now() WHERE id = $1", [replacement])
  expect(await offerableServiceIds(db, providerId)).toHaveLength(1)
})

it('a suspended person can delete', async () => {
  const old = await doc('dr1', 'rejected')
  await doc('dr1', 'pending')
  await pool.query("UPDATE users SET suspended_until = now() + interval '3 days' WHERE id = 'dr1'")
  expect((await del('dr1', old)).status).toBe(204)
  await pool.query("UPDATE users SET suspended_until = NULL WHERE id = 'dr1'")
})

it('storage down: the row is gone, the object stays owed and the daily job removes it later', async () => {
  const old = await doc('dr1', 'rejected')
  await doc('dr1', 'pending')
  setStorageForTests({ ...store, delete: async () => { throw new TypeError('down') } })
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  expect((await del('dr1', old)).status).toBe(204)
  log.mockRestore()
  setStorageForTests(store)
  expect(Number((await pool.query('SELECT count(*) n FROM pending_object_deletes')).rows[0].n)).toBe(1)
  const { flushPendingObjects } = await import('@kando/domain')
  expect(await flushPendingObjects()).toBe(0)
  expect(Number((await pool.query('SELECT count(*) n FROM pending_object_deletes')).rows[0].n)).toBe(0)
  expect(store.objects.size).toBe(1)
})
