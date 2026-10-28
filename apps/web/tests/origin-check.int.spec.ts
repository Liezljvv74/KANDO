import { afterEach, expect, it, vi } from 'vitest'
import { createAppRequest } from '@kando/domain'
import { seedUser, staff } from './helpers'

vi.mock('../lib/auth/server', async () => ({ ...(await (await import('./helpers')).mockAuth()), sessionFromRequest: (await import('./helpers')).fakeSession }))
const { adminRequest } = await import('../lib/admin-request')

const ctx = { params: Promise.resolve({}) }
const app = createAppRequest(async () => ({ id: 'oc-user', email: 'oc-user@test.skilled.invalid', emailVerified: true }))
const appRoute = app({ auth: 'required' }, async () => Response.json({ ran: true }))
const adminRoute = adminRequest('any', async () => Response.json({ ran: true }))
const req = (method: string, origin?: string) =>
  new Request('http://localhost:3000/x', { method, headers: origin ? { origin } : {} })

afterEach(() => vi.unstubAllEnvs())

for (const [name, route] of [['app API', appRoute], ['back office API', adminRoute]] as const) {
  it(`${name}: no Origin and the same Origin pass, a foreign Origin on a write is 403, a read with a foreign Origin passes`, async () => {
    await seedUser('oc-user', 'admin')
    staff.id = 'oc-user'
    expect((await route(req('POST'), ctx)).status).toBe(200)
    expect((await route(req('POST', 'http://localhost:3000'), ctx)).status).toBe(200)
    const foreign = await route(req('POST', 'https://evil.example'), ctx)
    expect(foreign.status).toBe(403)
    expect(await foreign.json()).toEqual({ error: 'Forbidden' })
    expect((await route(req('DELETE', 'https://evil.example'), ctx)).status).toBe(403)
    expect((await route(req('GET', 'https://evil.example'), ctx)).status).toBe(200)
  })
}

it('the configured site address counts as the same site', async () => {
  vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://kando.example')
  staff.id = 'oc-user'
  expect((await adminRoute(req('PATCH', 'https://kando.example'), ctx)).status).toBe(200)
  expect((await adminRoute(req('PATCH', 'https://other.example'), ctx)).status).toBe(403)
})

