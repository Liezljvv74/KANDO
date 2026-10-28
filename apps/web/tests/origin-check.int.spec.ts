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


it('a successful staff write leaves one audit line with ids only; reads and failures leave none', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  staff.id = 'oc-user'
  const route = adminRequest('any', async ({ request }) => new Response(null, { status: request.headers.get('x-fail') ? 409 : 200 }))
  const call = (method: string, headers: Record<string, string> = {}) =>
    route(new Request('http://localhost:3000/api/admin/users/u-7/suspend?secret=1', { method, headers, body: method === 'GET' ? undefined : '{"reason":"Anna Muster"}' }), { params: Promise.resolve({ id: 'u-7' }) })
  await call('GET')
  await call('POST', { 'x-fail': '1' })
  expect(log).not.toHaveBeenCalled()
  await call('POST')
  expect(log).toHaveBeenCalledTimes(1)
  const line = String(log.mock.calls[0]![0])
  expect(JSON.parse(line)).toEqual({ audit: 'staff-action', time: expect.any(String), staffId: 'oc-user', method: 'POST', path: '/api/admin/users/u-7/suspend', targetId: 'u-7' })
  expect(line).not.toMatch(/Anna|secret/)
  log.mockRestore()
})
