import { createNeonAuth } from '@neondatabase/auth/next/server'
import type { Session } from '@kando/domain'

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
 * The session behind a request Cookie header, or null. Goes through the auth handler get-session
 * in-process (cookie cache first, upstream otherwise), so it works for any Request, including a hand-built one;
 * auth.getSession() only reads the cookies of the current Next.js request scope.
 */
export async function sessionFromRequest(request: Request): Promise<Session | null> {
  const cookie = request.headers.get('cookie')
  if (!cookie) return null
  const res = await getAuth()
    .handler()
    .GET(new Request(new URL('/api/auth/get-session', request.url), { headers: { cookie } }), {
      params: Promise.resolve({ path: ['get-session'] }),
    })
  if (!res.ok) return null
  const body = (await res.json().catch(() => null)) as { user?: { id?: string; email?: string; emailVerified?: boolean; name?: string } } | null
  const u = body?.user
  return u?.id && u.email ? { id: u.id, email: u.email, emailVerified: u.emailVerified === true, name: u.name } : null
}
