import { createNeonAuth } from '@neondatabase/auth/next/server'
import { AuthUnavailableError, type Session } from '@kando/domain'

type Auth = ReturnType<typeof createNeonAuth>
let _auth: Auth | undefined

// Created on first use so `next build` needs no auth env.
export function getAuth(): Auth {
  return (_auth ??= createNeonAuth({
    baseUrl: process.env.NEON_AUTH_BASE_URL!,
    cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET! },
  }))
}

/**
 * Checks the person's password by signing in through the auth handler in-process, like a normal login (the caller's
 * headers without its Cookie; Origin = this server). The Neon Auth proxy forwards no client IP, so its sign-in limits are shared by
 * everyone, the same as for the login screen.
 * The session that sign-in creates is signed out at once with its own cookies; none of the answers reach the caller.
 * 'busy': any answer other than 200 or 401 (a rate limit, Neon Auth down) or a thrown error. The password is never logged.
 */
export async function verifyPassword(request: Request, email: string, password: string, handler = getAuth().handler()): Promise<'ok' | 'wrong' | 'busy'> {
  const origin = new URL(request.url).origin
  const post = (path: string, headers: Headers, body?: string) =>
    handler.POST(new Request(new URL(`/api/auth/${path}`, origin), { method: 'POST', headers, body }), { params: Promise.resolve({ path: path.split('/') }) })
  try {
    const headers = new Headers(request.headers)
    for (const h of ['cookie', 'content-length']) headers.delete(h)
    headers.set('content-type', 'application/json')
    headers.set('origin', origin)
    const res = await post('sign-in/email', headers, JSON.stringify({ email, password }))
    if (res.status === 401) return 'wrong'
    if (res.status !== 200) {
      console.error(`[verifyPassword] busy: auth status ${res.status}`)
      return 'busy'
    }
    const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    await post('sign-out', new Headers({ cookie, origin }))
    return 'ok'
  } catch (e) {
    console.error(`[verifyPassword] busy: ${e instanceof Error ? e.name : 'error'}`)
    return 'busy'
  }
}

/**
 * The session behind a request Cookie header, or null. Goes through the auth handler get-session
 * in-process (cookie cache first, upstream otherwise), so it works for any Request, including a hand-built one;
 * auth.getSession() only reads the cookies of the current Next.js request scope.
 */
export async function sessionFromRequest(request: Request): Promise<Session | null> {
  const cookie = request.headers.get('cookie')
  if (!cookie) return null
  let res: Response
  try {
    res = await getAuth()
      .handler()
      .GET(new Request(new URL('/api/auth/get-session', request.url), { headers: { cookie } }), {
        params: Promise.resolve({ path: ['get-session'] }),
      })
  } catch (e) {
    throw new AuthUnavailableError(e instanceof Error ? e.name : 'error') // the name only: a message could carry the cookie
  }
  return sessionFromAuthResponse(res)
}

/** The get-session answer read: 200 with a user is the session; 200 without one or 401 is signed out; anything else (429, 5xx) throws AuthUnavailableError. */
export async function sessionFromAuthResponse(res: Response): Promise<Session | null> {
  if (res.status === 401) return null
  if (!res.ok) throw new AuthUnavailableError(`auth status ${res.status}`)
  const body = (await res.json().catch(() => null)) as { user?: { id?: string; email?: string; emailVerified?: boolean; name?: string } } | null
  const u = body?.user
  return u?.id && u.email ? { id: u.id, email: u.email, emailVerified: u.emailVerified === true, name: u.name } : null
}
