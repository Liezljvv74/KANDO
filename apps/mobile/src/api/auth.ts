import { api, clearSession, getCookie } from '@/api/client'

/** The account as the auth server returns it; `emailVerified` decides whether the app counts it as signed in. */
export type SessionUser = { id: string; name: string; email: string; emailVerified: boolean }

// Better Auth (Neon Auth) through the web app's /api/auth catch-all. Cookies are stored and sent by `api`.
const post = <T>(path: string, body: object, detached?: string) => api<T>(`/api/auth${path}`, { method: 'POST', body, detached })

export const signUp = async (email: string, password: string, name: string) =>
  (await post<{ user: SessionUser }>('/sign-up/email', { email, password, name })).user

export const signIn = async (email: string, password: string) =>
  (await post<{ user: SessionUser }>('/sign-in/email', { email, password })).user

/** Signed out on the phone at once; the server call is not awaited, so a slow or unreachable server never blocks it. */
export async function signOut(): Promise<void> {
  const cookie = await getCookie()
  if (!cookie) return
  await clearSession()
  // Detached: its answer (cookies cleared) must not touch a session started meanwhile.
  post('/sign-out', {}, cookie).catch(() => {})
}

/** The signed-in account, or null (no cookie, or the server no longer knows it). Network errors throw. */
export async function session(): Promise<SessionUser | null> {
  if (!(await getCookie())) return null
  const data = await api<{ user: SessionUser } | null>('/api/auth/get-session')
  if (!data?.user) await clearSession()
  return data?.user ?? null
}

export const sendVerificationCode = (email: string) => post('/email-otp/send-verification-otp', { email, type: 'email-verification' })

/** The server signs in after a correct code (new session cookie) and returns the verified account. */
export const verifyEmail = async (email: string, code: string) =>
  (await post<{ user: SessionUser }>('/email-otp/verify-email', { email, otp: code })).user

export const requestPasswordReset = (email: string) => post('/forget-password/email-otp', { email })

export const resetPassword = (email: string, code: string, password: string) =>
  post('/email-otp/reset-password', { email, otp: code, password })

/** The auth account's name (what get-session returns); the app's own copy is saved with `updateMe`. */
export const updateUserName = (name: string) => post('/update-user', { name })
