import { afterAll, describe, expect, it } from 'vitest'
import { pool } from '@kando/db'

const enabled = !!process.env.NEON_AUTH_BASE_URL && !!process.env.NEON_AUTH_COOKIE_SECRET
if (!enabled) console.log('auth-cookie-flow skipped: NEON_AUTH_BASE_URL / NEON_AUTH_COOKIE_SECRET not set')

const email = `kando-test-${Date.now()}@test.skilled.invalid`

describe.skipIf(!enabled)('auth cookie flow', () => {
  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email = $1', [email]) // the Neon Auth user stays on the dev branch
  })

  it('signs up by REST, captures the cookie, and the cookie authenticates /app-api/v1/me', async () => {
    const { POST, GET } = await import('../app/api/auth/[...path]/route')
    const { GET: me } = await import('../app/app-api/v1/me/route')
    const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split('/') }) })

    const signUp = await POST(
      new Request('http://localhost/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost' },
        body: JSON.stringify({ email, password: 'TestPass123!', name: 'Kando Test' }),
      }),
      ctx('sign-up/email'),
    )
    expect(signUp.status, await signUp.clone().text()).toBe(200)
    const setCookies = signUp.headers.getSetCookie()
    expect(setCookies.length).toBeGreaterThan(0)
    const cookie = setCookies.map((c) => c.split(';')[0]).join('; ')
    expect(cookie).toContain('session_token')

    const res = await me(new Request('http://localhost/app-api/v1/me', { headers: { cookie } }), {
      params: Promise.resolve({}),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ email, language: 'de', staffRole: null })

    // the same cookie also works against get-session through the catch-all
    const gs = await GET(new Request('http://localhost/api/auth/get-session', { headers: { cookie } }), ctx('get-session'))
    expect((await gs.json()).user.email).toBe(email)

    // a forged cookie is refused by the real resolver
    const forged = await me(
      new Request('http://localhost/app-api/v1/me', { headers: { cookie: '__Secure-neon-auth.session_token=forged' } }),
      { params: Promise.resolve({}) },
    )
    expect(forged.status).toBe(401)
  })
})
