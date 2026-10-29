import * as SecureStore from 'expo-secure-store'

import { api, upload, ApiError, getCookie, REQUEST_TIMEOUT_MS, SESSION_KEY, setOnUnauthorized, updateMe } from './client'

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>()
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
  }
})

// Stand-in for expo-file-system's File: SDK 58's global fetch (expo/fetch) only sends file parts that have bytes().
const mockUnreadable = new Set<string>()
jest.mock('expo-file-system', () => ({
  File: function (this: { uri: string; bytes: () => Promise<Uint8Array> }, uri: string) {
    this.uri = uri
    this.bytes = async () => {
      if (mockUnreadable.has(uri)) throw new Error("Missing 'READ' permission for accessing the file.")
      return new Uint8Array([1, 2, 3])
    }
  },
}))

/** A fetch answer; `cookies` become separate Set-Cookie headers. */
const json = (status: number, body: unknown, cookies: string[] = []) =>
  ({ ok: status < 400, status, headers: new Headers(cookies.map((c) => ['set-cookie', c] as [string, string])), json: async () => body }) as Response

const fetchMock = jest.fn()
globalThis.fetch = fetchMock

const onUnauthorized = jest.fn()
setOnUnauthorized(onUnauthorized)
const headers = (call: number) => (fetchMock.mock.calls[call][1] as RequestInit & { headers: Record<string, string> }).headers

const TOKEN = '__Secure-neon-auth.session_token=old'

beforeEach(async () => {
  fetchMock.mockReset()
  onUnauthorized.mockReset()
  await SecureStore.setItemAsync(SESSION_KEY, TOKEN)
})

test('sends the stored cookie and stores a new set-cookie', async () => {
  fetchMock.mockResolvedValueOnce(
    json(200, { ok: true }, [
      '__Secure-neon-auth.session_token=new; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax',
      '__Secure-neon-auth.session_data=cache; Max-Age=300; Path=/; HttpOnly; Secure',
    ]),
  )
  await expect(api('/app-api/v1/me')).resolves.toEqual({ ok: true })
  expect(headers(0).Cookie).toBe(TOKEN)
  expect(await getCookie()).toBe('__Secure-neon-auth.session_token=new; __Secure-neon-auth.session_data=cache')

  // A later answer that only renews one cookie keeps the other; a cleared cookie (Max-Age=0) is dropped.
  fetchMock.mockResolvedValueOnce(json(200, {}, ['__Secure-neon-auth.session_data=; Max-Age=0; Path=/']))
  await api('/app-api/v1/me')
  expect(headers(1).Cookie).toBe('__Secure-neon-auth.session_token=new; __Secure-neon-auth.session_data=cache')
  expect(await getCookie()).toBe('__Secure-neon-auth.session_token=new')
})

test('a single joined set-cookie header (no getSetCookie) is split into its cookies', async () => {
  const joined = 'a=1; Expires=Mon, 21 Oct 2030 07:28:00 GMT; Path=/, b=2; Path=/'
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200, headers: { get: (n: string) => (n === 'set-cookie' ? joined : null) }, json: async () => ({}) } as unknown as Response)
  await api('/app-api/v1/me')
  expect(await getCookie()).toBe(`${TOKEN}; a=1; b=2`)
})

test('clears the session on 401', async () => {
  fetchMock.mockResolvedValueOnce(json(401, { error: 'Unauthorized' }))
  const err = await api('/app-api/v1/me').catch((e: ApiError) => e)
  expect(err).toBeInstanceOf(ApiError)
  expect(err).toMatchObject({ status: 401, code: 'Unauthorized' })
  expect(fetchMock).toHaveBeenCalledTimes(1) // no refresh, no retry
  expect(await getCookie()).toBeNull()
  expect(onUnauthorized).toHaveBeenCalledTimes(1)
})

test('a 401 without a stored session does not call onUnauthorized', async () => {
  await SecureStore.deleteItemAsync(SESSION_KEY)
  fetchMock.mockResolvedValueOnce(json(401, { message: 'Invalid email or password', code: 'INVALID_EMAIL_OR_PASSWORD' }))
  await expect(api('/api/auth/sign-in/email', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 401, code: 'INVALID_EMAIL_OR_PASSWORD' })
  expect(headers(0)).not.toHaveProperty('Cookie')
  expect(onUnauthorized).not.toHaveBeenCalled()
})

test('every request names the app origin and leaves the platform cookie store out', async () => {
  fetchMock.mockResolvedValueOnce(json(200, {}))
  await api('/app-api/v1/me')
  const init = fetchMock.mock.calls[0][1] as RequestInit & { headers: Record<string, string> }
  expect(init.headers.Origin).toBe('https://skillweb.space')
  expect(init.credentials).toBe('omit')
})

test('a 409 with error and missing throws ApiError with code and missing', async () => {
  fetchMock.mockResolvedValueOnce(json(409, { error: 'Profile incomplete', missing: ['service'] }))
  const err = await api('/app-api/v1/provider-profile/publish', { method: 'POST' }).catch((e: ApiError) => e)
  expect(err).toMatchObject({ status: 409, code: 'Profile incomplete', missing: ['service'] })
})

test('a 400 "Invalid input" lists the fields named by its issues', async () => {
  fetchMock.mockResolvedValueOnce(json(400, { error: 'Invalid input', issues: [{ path: ['bio'] }, { path: ['skills', 2] }, { path: [] }] }))
  await expect(api('/app-api/v1/provider-profile', { method: 'PUT', body: {} })).rejects.toMatchObject({ status: 400, code: 'Invalid input', fields: ['bio', 'skills'] })
})

test('a network failure throws ApiError(0, network)', async () => {
  fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'))
  await expect(api('/app-api/v1/me')).rejects.toMatchObject({ status: 0, code: 'network' })
})

test('a server that never answers fails as network after the time limit', async () => {
  jest.useFakeTimers()
  try {
    // Like real fetch: the request only ends when it is aborted.
    fetchMock.mockImplementationOnce((_u: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))))
    const result = api('/app-api/v1/provider-profile').catch((e) => e)
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
    expect(await result).toMatchObject({ status: 0, code: 'network' })
  } finally {
    jest.useRealTimers()
  }
})

test('saves have no time limit: a slow save that succeeds is not reported as a failure', async () => {
  fetchMock.mockResolvedValueOnce(json(201, { id: 'a' }))
  await expect(api('/app-api/v1/services', { method: 'POST', body: { title: 'x' } })).resolves.toEqual({ id: 'a' })
  expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeUndefined()
})

test('updateMe PATCHes the account name', async () => {
  fetchMock.mockResolvedValueOnce(json(200, { id: 'u1', name: 'Anna Berg', language: 'de' }))
  await expect(updateMe({ name: 'Anna Berg' })).resolves.toMatchObject({ name: 'Anna Berg' })
  const [u, init] = fetchMock.mock.calls[0]
  expect(String(u)).toMatch(/\/app-api\/v1\/me$/)
  expect(init).toMatchObject({ method: 'PATCH', body: JSON.stringify({ firstName: 'Anna', lastName: 'Berg' }) })
})

const file = { uri: 'file:///a.jpg', name: 'a.jpg', type: 'image/jpeg' }

test('upload sends multipart with the cookie and no time limit', async () => {
  fetchMock.mockResolvedValueOnce(json(201, { id: 'f1' }))
  await expect(upload('/app-api/v1/files', file, { kind: 'x' })).resolves.toEqual({ id: 'f1' })
  const init = fetchMock.mock.calls[0][1] as RequestInit & { headers: Record<string, string> }
  expect(init.body).toBeInstanceOf(FormData)
  expect((init.body as FormData).get('kind')).toBe('x')
  expect(init.headers.Cookie).toBe(TOKEN)
  expect(init.headers).not.toHaveProperty('Content-Type')
  expect(init.signal).toBeUndefined()
})

test('upload sends the file bytes with its name and type, not a bare { uri } object', async () => {
  fetchMock.mockResolvedValueOnce(json(201, { id: 'f1' }))
  // Node's FormData stringifies non-Blob values, so capture what upload hands to append.
  const append = jest.spyOn(FormData.prototype, 'append')
  await upload('/app-api/v1/files', file, {})
  const part = append.mock.calls.find(([name]) => name === 'file')?.[1] as unknown as { name: string; type: string; bytes: () => Promise<Uint8Array> }
  append.mockRestore()
  expect(part).toMatchObject({ name: 'a.jpg', type: 'image/jpeg' })
  await expect(part.bytes()).resolves.toEqual(new Uint8Array([1, 2, 3]))
})

test('a file the phone cannot open is "File unreadable", not a network error, and nothing is sent', async () => {
  mockUnreadable.add('file:///locked.pdf')
  await expect(upload('/app-api/v1/files', { ...file, uri: 'file:///locked.pdf' }, {})).rejects.toMatchObject({ status: 0, code: 'File unreadable' })
  expect(fetchMock).not.toHaveBeenCalled()
})

test('upload maps a 413 to ApiError "File too large"', async () => {
  // Vercel rejects an over-limit body itself, with a non-JSON answer.
  fetchMock.mockResolvedValueOnce({ ok: false, status: 413, headers: new Headers(), json: async () => { throw new Error('not json') } } as unknown as Response)
  await expect(upload('/app-api/v1/files', file, {})).rejects.toMatchObject({ status: 413, code: 'File too large' })
})

test('upload maps a network failure to ApiError network and does not retry', async () => {
  fetchMock.mockRejectedValue(new Error('offline'))
  await expect(upload('/app-api/v1/files', file, {})).rejects.toMatchObject({ status: 0, code: 'network' })
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test('a store that cannot be read (Keystore failure) sends the request without a cookie', async () => {
  jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('Could not decrypt'))
  fetchMock.mockResolvedValueOnce(json(200, { ok: true }))
  await expect(api('/app-api/v1/categories')).resolves.toEqual({ ok: true })
  expect(headers(0)).not.toHaveProperty('Cookie')
})

test('a cookie that cannot be saved does not fail a request the server already carried out', async () => {
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('Keystore busy'))
  fetchMock.mockResolvedValueOnce(json(200, { status: true }, ['__Secure-neon-auth.session_token=new; Path=/']))
  await expect(api('/api/auth/email-otp/verify-email', { method: 'POST', body: {} })).resolves.toEqual({ status: true })
})

test('a malformed Set-Cookie line without "=" is skipped', async () => {
  fetchMock.mockResolvedValueOnce(json(200, {}, ['garbage; Path=/', 'b=2; Path=/']))
  await api('/app-api/v1/me')
  expect(await getCookie()).toBe(`${TOKEN}; b=2`)
})

test('updateMe sends the one-field name as first and last name, split at the last space', async () => {
  fetchMock.mockResolvedValue(json(200, {}))
  for (const name of ['Anna Lena von der Heide', 'Cher', '   ']) await updateMe({ name, language: 'en' })
  const bodies = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body))
  expect(bodies.slice(-3)).toEqual([
    { firstName: 'Anna Lena von der', lastName: 'Heide', language: 'en' },
    { firstName: 'Cher', language: 'en' },
    { language: 'en' },
  ])
})

test('text mode reads a successful answer as text and still parses an error as JSON', async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), text: async () => 'a,b' } as unknown as Response)
  await expect(api('/app-api/v1/me/export?format=csv', { text: true })).resolves.toBe('a,b')
  fetchMock.mockResolvedValueOnce(json(400, { error: 'BAD_FORMAT' }))
  await expect(api('/app-api/v1/me/export?format=x', { text: true })).rejects.toMatchObject({ status: 400, code: 'BAD_FORMAT' })
})
test('an ok answer whose body cannot be read is a network failure, not null', async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), json: async () => { throw new Error('truncated') } } as unknown as Response)
  await expect(api('/app-api/v1/me/export')).rejects.toMatchObject({ status: 0, code: 'network' })
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), text: async () => { throw new Error('truncated') } } as unknown as Response)
  await expect(api('/app-api/v1/me/export?format=csv', { text: true })).rejects.toMatchObject({ status: 0, code: 'network' })
})

test('a time limit given in milliseconds is used instead of the default one', async () => {
  jest.useFakeTimers()
  try {
    fetchMock.mockImplementationOnce((_u: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))))
    let settled = false
    const result = api('/app-api/v1/me', { method: 'DELETE', timeLimit: 60_000 }).catch((e) => ((settled = true), e))
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1)
    expect(settled).toBe(false) // still waiting after the default limit
    await jest.advanceTimersByTimeAsync(60_000)
    expect(await result).toMatchObject({ status: 0, code: 'network' })
  } finally {
    jest.useRealTimers()
  }
})

test('a 204 No Content answer (report, block) succeeds without a body', async () => {
  fetchMock.mockResolvedValueOnce({ ok: true, status: 204, headers: new Headers(), json: async () => Promise.reject(new SyntaxError('Unexpected end of JSON')) })
  await expect(api('/app-api/v1/blocks', { method: 'POST', body: { userId: 'u' } })).resolves.toBeNull()
})
