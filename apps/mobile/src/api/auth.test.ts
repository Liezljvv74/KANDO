import * as SecureStore from 'expo-secure-store'

import { errorText, setLang } from '@/i18n'

import { requestPasswordReset, resetPassword, sendVerificationCode, session, signIn, signOut, signUp, verifyEmail } from './auth'
import { getCookie, SESSION_KEY } from './client'

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>()
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
  }
})

const json = (status: number, body: unknown, cookies: string[] = []) =>
  ({ ok: status < 400, status, headers: new Headers(cookies.map((c) => ['set-cookie', c] as [string, string])), json: async () => body }) as Response

const fetchMock = jest.fn()
globalThis.fetch = fetchMock

/** URL, method and parsed JSON body of a fetch call. */
const sent = (call = 0) => {
  const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit & { headers: Record<string, string> }]
  return { url: String(url), method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: init.headers }
}

const user = { id: 'u1', name: 'Anna', email: 'a@b.de', emailVerified: true }
const COOKIE = '__Secure-neon-auth.session_token=abc'

beforeEach(async () => {
  fetchMock.mockReset()
  await SecureStore.deleteItemAsync(SESSION_KEY)
})

test('signUp posts email, password and name and stores the session cookie', async () => {
  fetchMock.mockResolvedValueOnce(json(200, { token: 't', user: { ...user, emailVerified: false } }, [`${COOKIE}; Max-Age=604800; Path=/; HttpOnly; Secure`]))
  await expect(signUp('a@b.de', 'secret123', 'Anna')).resolves.toMatchObject({ emailVerified: false })
  expect(sent()).toMatchObject({ url: 'https://skillweb.space/api/auth/sign-up/email', method: 'POST', body: { email: 'a@b.de', password: 'secret123', name: 'Anna' } })
  expect(await getCookie()).toBe(COOKIE)
})

test('signIn posts email and password and returns the user', async () => {
  fetchMock.mockResolvedValueOnce(json(200, { redirect: false, token: 't', user }, [`${COOKIE}; Path=/`]))
  await expect(signIn('a@b.de', 'secret123')).resolves.toEqual(user)
  expect(sent()).toMatchObject({ url: 'https://skillweb.space/api/auth/sign-in/email', method: 'POST', body: { email: 'a@b.de', password: 'secret123' } })
  expect(await getCookie()).toBe(COOKIE)
})

test('a refused sign-in throws the server code, which maps to a catalogue message', async () => {
  fetchMock.mockResolvedValueOnce(json(401, { message: 'Invalid email or password', code: 'INVALID_EMAIL_OR_PASSWORD' }))
  const err = await signIn('a@b.de', 'wrong').catch((e) => e)
  expect(err).toMatchObject({ status: 401, code: 'INVALID_EMAIL_OR_PASSWORD' })
  setLang('en')
  expect(errorText(err.code)).toContain('Email or password is incorrect.')
})

test('signOut forgets the session at once and tells the server with the old cookie', async () => {
  await SecureStore.setItemAsync(SESSION_KEY, COOKIE)
  fetchMock.mockReturnValueOnce(new Promise(() => {})) // the server never answers
  await signOut()
  expect(await getCookie()).toBeNull()
  expect(sent()).toMatchObject({ url: 'https://skillweb.space/api/auth/sign-out', method: 'POST' })
  expect(sent().headers.Cookie).toBe(COOKIE)
})

test('signOut offline still signs out', async () => {
  await SecureStore.setItemAsync(SESSION_KEY, COOKIE)
  fetchMock.mockRejectedValueOnce(new TypeError('offline'))
  await signOut()
  expect(await getCookie()).toBeNull()
})

test('session reads get-session with the cookie; no cookie means null without a request', async () => {
  await expect(session()).resolves.toBeNull()
  expect(fetchMock).not.toHaveBeenCalled()

  await SecureStore.setItemAsync(SESSION_KEY, COOKIE)
  fetchMock.mockResolvedValueOnce(json(200, { session: { expiresAt: '2026-11-02' }, user }))
  await expect(session()).resolves.toEqual(user)
  expect(sent()).toMatchObject({ url: 'https://skillweb.space/api/auth/get-session', method: 'GET' })
  expect(sent().headers.Cookie).toBe(COOKIE)

  // An expired session answers 200 null: the stored cookie goes.
  fetchMock.mockResolvedValueOnce(json(200, null))
  await expect(session()).resolves.toBeNull()
  expect(await getCookie()).toBeNull()
})

test('session throws on a network error (the app offers a retry, not the login)', async () => {
  await SecureStore.setItemAsync(SESSION_KEY, COOKIE)
  fetchMock.mockRejectedValueOnce(new TypeError('offline'))
  await expect(session()).rejects.toMatchObject({ status: 0, code: 'network' })
  expect(await getCookie()).toBe(COOKIE)
})

test('sendVerificationCode asks for an email-verification code', async () => {
  fetchMock.mockResolvedValueOnce(json(200, { success: true }))
  await sendVerificationCode('a@b.de')
  expect(sent()).toMatchObject({ url: 'https://skillweb.space/api/auth/email-otp/send-verification-otp', method: 'POST', body: { email: 'a@b.de', type: 'email-verification' } })
})

test('verifyEmail sends the code as otp, stores the new session and returns the user', async () => {
  fetchMock.mockResolvedValueOnce(json(200, { status: true, token: 't', user }, [`${COOKIE}; Path=/`]))
  await expect(verifyEmail('a@b.de', '123456')).resolves.toEqual(user)
  expect(sent()).toMatchObject({ url: 'https://skillweb.space/api/auth/email-otp/verify-email', method: 'POST', body: { email: 'a@b.de', otp: '123456' } })
  expect(await getCookie()).toBe(COOKIE)
})

test('requestPasswordReset asks for a reset code', async () => {
  fetchMock.mockResolvedValueOnce(json(200, { success: true }))
  await requestPasswordReset('a@b.de')
  expect(sent()).toMatchObject({ url: 'https://skillweb.space/api/auth/forget-password/email-otp', method: 'POST', body: { email: 'a@b.de' } })
})

test('resetPassword sends email, code and the new password', async () => {
  fetchMock.mockResolvedValueOnce(json(200, { success: true }))
  await resetPassword('a@b.de', '654321', 'newsecret1')
  expect(sent()).toMatchObject({ url: 'https://skillweb.space/api/auth/email-otp/reset-password', method: 'POST', body: { email: 'a@b.de', otp: '654321', password: 'newsecret1' } })
})

test('a wrong code throws INVALID_OTP, shown as the code message', async () => {
  fetchMock.mockResolvedValueOnce(json(400, { message: 'Invalid OTP', code: 'INVALID_OTP' }))
  const err = (await resetPassword('a@b.de', '000000', 'newsecret1').catch((e) => e)) as { code: string }
  expect(err).toMatchObject({ status: 400, code: 'INVALID_OTP' })
  setLang('de')
  expect(errorText(err.code)).toContain('Der Code ist falsch oder abgelaufen.')
})

test('signUp and signIn start without an old stored session', async () => {
  await SecureStore.setItemAsync(SESSION_KEY, 'stale=1')
  fetchMock.mockResolvedValueOnce(json(200, { user }))
  await signIn('a@b.de', 'secret123')
  expect(sent().headers).not.toHaveProperty('Cookie')
  await SecureStore.setItemAsync(SESSION_KEY, 'stale=1')
  fetchMock.mockResolvedValueOnce(json(200, { user }))
  await signUp('a@b.de', 'secret123', 'Anna')
  expect(sent(1).headers).not.toHaveProperty('Cookie')
})
