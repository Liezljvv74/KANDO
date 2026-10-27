import { File as FsFile } from 'expo-file-system'
import * as SecureStore from 'expo-secure-store'

import type { Address, Me } from '@kando/contract'

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://skillweb.space'
const ORIGIN = new URL(API_URL).origin

/** The session cookies (`name=value; name=value`), sent back as the Cookie header on every request. */
export const SESSION_KEY = 'skilled.session'
/** A read with no answer by then fails as 'network', so screens show the retry instead of spinning forever. */
export const REQUEST_TIMEOUT_MS = 15_000

/** `code` is the server's machine string (`error`, else the auth server's `code`); 'network' when offline. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public missing?: string[],
    public fields?: string[],
  ) {
    super(code)
  }
}

/** The stored cookies, or null. An unreadable store (e.g. a Keystore that cannot decrypt) counts as signed out and is cleared. */
export async function getCookie(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SESSION_KEY)
  } catch (e) {
    if (__DEV__) console.warn('reading the session failed:', e)
    await SecureStore.deleteItemAsync(SESSION_KEY).catch(() => {})
    return null
  }
}
export const clearSession = () => SecureStore.deleteItemAsync(SESSION_KEY)

let onUnauthorized: (() => void) | null = null
/** Called when the server no longer accepts the session (cookie cleared); `use-session` registers it to show the login. */
export const setOnUnauthorized = (fn: (() => void) | null) => {
  onUnauthorized = fn
}

/** Set-Cookie lines; a platform that joins them into one header gets split at the commas that start a new cookie. */
function setCookieLines(headers: Headers): string[] {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const joined = headers.get('set-cookie')
  return joined ? joined.split(/,(?=\s*[^;,=\s]+=)/) : []
}

/**
 * Merges the answer's cookies into the stored ones: same name replaces, an empty or expired cookie is removed.
 * Never throws: the server has already acted (a used code, a saved profile), so a store failure must not fail the request.
 */
async function storeCookies(res: Response) {
  try {
    await mergeCookies(res)
  } catch (e) {
    if (__DEV__) console.warn('saving the session failed:', e)
  }
}

async function mergeCookies(res: Response) {
  const lines = res.headers ? setCookieLines(res.headers) : []
  if (!lines.length) return
  const jar = new Map<string, string>()
  for (const pair of ((await getCookie()) ?? '').split('; ').filter(Boolean)) jar.set(pair.slice(0, pair.indexOf('=')), pair)
  for (const line of lines) {
    const [pair, ...attrs] = line.split(';').map((s) => s.trim())
    if (!pair.includes('=') || pair.startsWith('=')) continue // malformed line
    const name = pair.slice(0, pair.indexOf('='))
    const value = pair.slice(pair.indexOf('=') + 1)
    const gone = !value || attrs.some((a) => /^max-age=\s*(0|-\d+)$/i.test(a) || (/^expires=/i.test(a) && Date.parse(a.slice(8)) <= Date.now()))
    if (gone) jar.delete(name)
    else jar.set(name, `${name}=${value}`)
  }
  const cookie = [...jar.values()].join('; ')
  if (cookie) await SecureStore.setItemAsync(SESSION_KEY, cookie)
  else await clearSession()
}

/** `detached`: send this cookie instead of the stored one and leave the store alone (the sign-out call after the local clear). */
type Init = { method?: string; body?: unknown; timeLimit?: boolean; detached?: string }

async function send(path: string, { method = 'GET', body, timeLimit = method === 'GET', detached }: Init, cookie: string | null) {
  // Better Auth refuses cookie-carrying writes without a trusted Origin; the app names the API's own origin.
  const headers: Record<string, string> = { Accept: 'application/json', Origin: ORIGIN }
  const form = body instanceof FormData
  // A FormData body gets its Content-Type (with the boundary) from fetch.
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json'
  if (cookie) headers.Cookie = cookie
  // Only reads are cut off: a slow save may still succeed, and retrying it could save twice.
  const abort = timeLimit ? new AbortController() : null
  const timer = abort && setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
  let res: Response
  try {
    // credentials 'omit': the platform's own cookie store stays out; the session lives only in SecureStore.
    res = await fetch(`${API_URL}${path}`, { method, headers, credentials: 'omit', body: body === undefined || form ? (body as FormData | undefined) : JSON.stringify(body), signal: abort?.signal })
  } catch (e) {
    // The screen only says "Cannot reach the server"; the real cause goes to the developer's terminal.
    if (__DEV__) console.warn(`${method} ${path} failed:`, e)
    throw new ApiError(0, 'network')
  } finally {
    // The limit covers waiting for the answer to start; a reply that has arrived is always read.
    if (timer) clearTimeout(timer)
  }
  if (detached === undefined) await storeCookies(res)
  const data = await res.json().catch(() => null)
  return { res, data }
}

type ErrorBody = { error?: string; code?: string; message?: string; missing?: unknown; fields?: unknown; issues?: { path?: unknown[] }[] } | null

function toError(status: number, data: ErrorBody): ApiError {
  // Vercel answers an over-limit body (our 4.5 MB cap) itself, without a JSON body.
  const code = data?.error ?? data?.code ?? data?.message ?? (status === 413 ? 'File too large' : `HTTP ${status}`)
  // 'Invalid fields' lists `fields`; 'Invalid input' (contract parse) lists zod `issues` with a path.
  const fields = Array.isArray(data?.fields)
    ? (data.fields as string[])
    : Array.isArray(data?.issues)
      ? [...new Set(data.issues.map((i) => i.path?.[0]).filter((f): f is string => typeof f === 'string'))]
      : undefined
  return new ApiError(status, String(code), Array.isArray(data?.missing) ? (data.missing as string[]) : undefined, fields)
}

export type PickedFile = { uri: string; name: string; type: string; size?: number }

/** Multipart upload: `api` with a FormData body (no time limit, as for any write). */
export async function upload<T>(path: string, file: PickedFile, fields: Record<string, string>): Promise<T> {
  // Read first, so a file the phone cannot open (a cloud file that is not downloaded, a missing permission) gets its own
  // message instead of "Cannot reach the server".
  let bytes: Uint8Array
  try {
    bytes = await new FsFile(file.uri).bytes()
  } catch (e) {
    if (__DEV__) console.warn('reading the upload failed:', e)
    throw new ApiError(0, 'File unreadable')
  }
  const body = new FormData()
  // SDK 58's global fetch (expo/fetch) sends file parts that can give their bytes; React Native's { uri } parts are refused.
  // The name makes it a file part; the server sniffs the real type and picks its own file name.
  body.append('file', { name: file.name || 'upload', type: file.type, bytes: async () => bytes } as unknown as Blob)
  for (const [k, v] of Object.entries(fields)) body.append(k, v)
  return api<T>(path, { method: 'POST', body })
}

/** One request with the stored session. A 401 to a request that carried a session clears it and signs out (no refresh). */
export async function api<T>(path: string, init: Init = {}): Promise<T> {
  const cookie = init.detached ?? (await getCookie())
  const { res, data } = await send(path, init, cookie)
  if (res.status === 401 && cookie && init.detached === undefined) {
    await clearSession()
    onUnauthorized?.()
  }
  if (!res.ok) throw toError(res.status, data)
  return data as T
}

/** The one-field account name as first and last name: the last space splits ("Anna-Lena von der Heide" has no better answer). */
export function splitName(name: string): { firstName?: string; lastName?: string } {
  const s = name.trim()
  const i = s.lastIndexOf(' ')
  if (!s) return {}
  return i < 0 ? { firstName: s } : { firstName: s.slice(0, i).trim(), lastName: s.slice(i + 1) }
}

/** The signed-in person's own record (picture, address, ...). */
export const getMe = () => api<Me>('/app-api/v1/me')

/** Changes the account name (`name` is split into first and last name; the server derives the public name), the language of emails and/or the private address. */
export const updateMe = ({ name, ...rest }: { name?: string; firstName?: string; lastName?: string; language?: Me['language']; address?: Address | null }) =>
  api<Partial<Me>>('/app-api/v1/me', { method: 'PATCH', body: { ...(name !== undefined && splitName(name)), ...rest } })
