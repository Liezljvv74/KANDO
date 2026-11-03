import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { setStorageForTests } from '@kando/domain/src/testing'
import { call, cleanupUsers, memoryStorage, seedBase, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const meRoute = await import('../app/app-api/v1/me/route')
const exportRoute = await import('../app/app-api/v1/me/export/route')

beforeAll(async () => {
  setStorageForTests(memoryStorage())
  await seedBase()
  await seedUser('tc1')
  await pool.query('UPDATE users SET terms_accepted_at = NULL WHERE id = $1', ['tc1'])
})
afterAll(async () => {
  setStorageForTests(undefined)
  await cleanupUsers()
})

const accepted = async () => (await pool.query('SELECT terms_accepted_at FROM users WHERE id = $1', ['tc1'])).rows[0].terms_accepted_at as Date | null

it('stores the time the Terms were accepted, only when asked, and the export shows it', async () => {
  expect(await accepted()).toBeNull()
  expect((await call(meRoute.PATCH, 'tc1', 'PATCH', { firstName: 'Anna' })).status).toBe(200)
  expect(await accepted()).toBeNull() // other edits never set it
  expect((await call(meRoute.PATCH, 'tc1', 'PATCH', { termsAccepted: true })).status).toBe(200)
  expect(Math.abs(Date.now() - (await accepted())!.getTime())).toBeLessThan(60_000)
  const first = await accepted()
  await call(meRoute.PATCH, 'tc1', 'PATCH', { termsAccepted: true })
  expect((await accepted())!.getTime()).toBe(first!.getTime()) // a repeat never moves the first acceptance
  const exported = await (await call(exportRoute.GET, 'tc1')).json()
  expect(exported.user.termsAcceptedAt).toBeTruthy()
})

it('refuses anything but true', async () => {
  expect((await call(meRoute.PATCH, 'tc1', 'PATCH', { termsAccepted: false })).status).toBe(400)
})
