import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { TERMS_VERSION } from '@kando/contract'
import { call, cleanupUsers, seedBase, seedUser } from './helpers'

vi.mock('../lib/auth/server', async () => ({ sessionFromRequest: (await import('./helpers')).fakeSession }))
const meRoute = await import('../app/app-api/v1/me/route')
const pushRoute = await import('../app/app-api/v1/me/push/route')
const exportRoute = await import('../app/app-api/v1/me/export/route')
const blocksRoute = await import('../app/app-api/v1/blocks/route')

const setVersion = (id: string, v: string | null) => pool.query('UPDATE users SET terms_version = $2 WHERE id = $1', [id, v])
const row = async (id: string) => (await pool.query('SELECT terms_accepted_at AS at, terms_version AS v FROM users WHERE id = $1', [id])).rows[0] as { at: Date | null; v: string | null }
/** A background write (notification settings): never gated, so it never reopens the terms pop-up. */
const write = (id: string) => call(pushRoute.PATCH, id, 'PATCH', { chat: false })
/** A real change (blocking a person): gated while the terms are stale; the gate runs before the handler looks at the body. */
const gatedWrite = (id: string) => call(blocksRoute.POST, id, 'POST', { threadId: 'none' })

beforeAll(async () => {
  await seedBase()
  for (const id of ['tv1', 'tv2', 'tv3']) await seedUser(id)
  await pool.query('UPDATE users SET terms_accepted_at = NULL, terms_version = NULL WHERE id = $1', ['tv3'])
})
afterAll(cleanupUsers)

describe('terms version', () => {
  it('a person on the current version writes and is not asked (termsRequired false)', async () => {
    expect((await write('tv1')).status).toBe(200)
    expect((await (await call(meRoute.GET, 'tv1')).json()).termsRequired).toBe(false)
  })

  it('after the version changed: reads work, every write is 428 terms-required, termsRequired is true', async () => {
    await setVersion('tv1', '2020-01-01')
    expect((await call(meRoute.GET, 'tv1')).status).toBe(200)
    expect((await (await call(meRoute.GET, 'tv1')).json()).termsRequired).toBe(true)
    expect((await call(exportRoute.GET, 'tv1')).status).toBe(200) // their data stays reachable
    const res = await gatedWrite('tv1')
    expect(res.status).toBe(428)
    expect((await res.json()).error).toBe('terms-required')
    expect((await write('tv1')).status).toBe(200) // marking things seen and push switches never bring the pop-up back
  })

  it('with stale terms PATCH /me takes only the acceptance: any other change is 428', async () => {
    await setVersion('tv1', '2020-01-01')
    expect((await call(meRoute.PATCH, 'tv1', 'PATCH', { firstName: 'Zed' })).status).toBe(428)
    expect((await call(meRoute.PATCH, 'tv1', 'PATCH', { termsAccepted: true, termsVersion: TERMS_VERSION, firstName: 'Zed' })).status).toBe(428)
  })

  it('accepting the current version on PATCH /me is allowed, stamps time and version, and opens the writes again', async () => {
    const before = await row('tv1')
    const res = await call(meRoute.PATCH, 'tv1', 'PATCH', { termsAccepted: true, termsVersion: TERMS_VERSION })
    expect(res.status).toBe(200)
    expect((await res.json()).termsRequired).toBe(false)
    const after = await row('tv1')
    expect(after.v).toBe(TERMS_VERSION)
    expect(after.at!.getTime()).toBeGreaterThan(before.at!.getTime()) // the last acceptance counts
    expect((await write('tv1')).status).toBe(200)
    const again = await call(meRoute.PATCH, 'tv1', 'PATCH', { termsAccepted: true, termsVersion: TERMS_VERSION })
    expect(again.status).toBe(200)
    expect((await row('tv1')).at!.getTime()).toBe(after.at!.getTime()) // a repeat of the same version keeps the time
  })

  it('an app that shows an older text cannot accept the current one (409 terms-outdated) and nothing changes', async () => {
    await setVersion('tv2', '2020-01-01')
    const res = await call(meRoute.PATCH, 'tv2', 'PATCH', { termsAccepted: true, termsVersion: '2019-01-01' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('terms-outdated')
    expect((await row('tv2')).v).toBe('2020-01-01')
  })

  it('the sign-up call without a version records the current one; the export shows it', async () => {
    expect((await call(meRoute.PATCH, 'tv3', 'PATCH', { termsAccepted: true })).status).toBe(200)
    expect((await row('tv3')).v).toBe(TERMS_VERSION)
    expect((await (await call(exportRoute.GET, 'tv3')).json()).user.termsVersion).toBe(TERMS_VERSION)
  })

  it('an account that never accepted (an old test account) is not held back', async () => {
    await pool.query('UPDATE users SET terms_accepted_at = NULL, terms_version = NULL WHERE id = $1', ['tv3'])
    expect((await write('tv3')).status).toBe(200)
  })

  it('an account that accepted before must name the version; only the first acceptance may leave it out', async () => {
    const old = await call(meRoute.PATCH, 'tv2', 'PATCH', { termsAccepted: true })
    expect(old.status).toBe(409)
    expect((await old.json()).error).toBe('terms-outdated')
    expect((await call(meRoute.PATCH, 'tv3', 'PATCH', { termsAccepted: true })).status).toBe(200) // never accepted: the sign-up acceptance
  })
})
