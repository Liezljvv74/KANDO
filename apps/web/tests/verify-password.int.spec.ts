import { expect, it, vi } from 'vitest'
import { verifyPassword } from '../lib/auth/server'

type Call = { url: string; path: string[]; headers: Headers; body: string }
/** A stand-in for the Neon Auth handler: records each call and answers sign-in with `signIn`; sign-out with 200. */
function fakeHandler(signIn: () => Response) {
  const calls: Call[] = []
  const POST = async (request: Request, ctx: { params: Promise<{ path: string[] }> }) => {
    calls.push({ url: request.url, path: (await ctx.params).path, headers: request.headers, body: await request.text() })
    return request.url.endsWith('/sign-out') ? Response.json({ success: true }) : signIn()
  }
  return { calls, handler: { POST } as unknown as Parameters<typeof verifyPassword>[3] }
}

const incoming = () =>
  new Request('https://api.example.test/app-api/v1/me', {
    method: 'DELETE',
    headers: { cookie: '__Secure-neon-auth.session_token=callers-own', 'user-agent': 'KandoApp/1', 'content-type': 'application/json', 'content-length': '30' },
    body: JSON.stringify({ password: 'x' }),
  })

const signedIn = () => {
  const headers = new Headers({ 'content-type': 'application/json' })
  headers.append('set-cookie', '__Secure-neon-auth.session_token=temp-token; Path=/; HttpOnly; Secure')
  headers.append('set-cookie', '__Secure-neon-auth.local.session_data=temp-data; Path=/; HttpOnly; Secure')
  return new Response(JSON.stringify({ token: 'temp-token', user: {} }), { status: 200, headers })
}

it('200 is ok and the new session is signed out with its own cookie', async () => {
  const { calls, handler } = fakeHandler(signedIn)
  expect(await verifyPassword(incoming(), 'a@b.test', 'right', handler)).toBe('ok')
  expect(calls).toHaveLength(2)
  const [signIn, signOut] = calls
  expect(signIn!.url).toBe('https://api.example.test/api/auth/sign-in/email')
  expect(signIn!.path).toEqual(['sign-in', 'email'])
  expect(JSON.parse(signIn!.body)).toEqual({ email: 'a@b.test', password: 'right' })
  expect(signIn!.headers.get('origin')).toBe('https://api.example.test')
  expect(signIn!.headers.get('user-agent')).toBe('KandoApp/1')
  expect(signOut!.url).toBe('https://api.example.test/api/auth/sign-out')
  expect(signOut!.path).toEqual(['sign-out'])
  expect(signOut!.headers.get('cookie')).toBe('__Secure-neon-auth.session_token=temp-token; __Secure-neon-auth.local.session_data=temp-data')
  expect(signOut!.headers.get('origin')).toBe('https://api.example.test')
})

it('401 is wrong and nothing is signed out', async () => {
  const { calls, handler } = fakeHandler(() => Response.json({ code: 'INVALID_EMAIL_OR_PASSWORD' }, { status: 401 }))
  expect(await verifyPassword(incoming(), 'a@b.test', 'nope', handler)).toBe('wrong')
  expect(calls).toHaveLength(1)
})

it('429, 500 and a thrown error are busy', async () => {
  for (const status of [429, 500]) {
    const { calls, handler } = fakeHandler(() => new Response(null, { status }))
    expect(await verifyPassword(incoming(), 'a@b.test', 'x', handler)).toBe('busy')
    expect(calls).toHaveLength(1)
  }
  const { handler } = fakeHandler(() => {
    throw new TypeError('fetch failed')
  })
  expect(await verifyPassword(incoming(), 'a@b.test', 'x', handler)).toBe('busy')
})

it('the busy paths log one line with the status or error name and never the password', async () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await verifyPassword(incoming(), 'a@b.test', 'hunter2-secret', fakeHandler(() => new Response(null, { status: 429 })).handler)
    await verifyPassword(incoming(), 'a@b.test', 'hunter2-secret', fakeHandler(() => { throw new TypeError('fetch failed hunter2-secret') }).handler)
    expect(spy).toHaveBeenCalledTimes(2)
    const lines = spy.mock.calls.map((c) => c.join(' '))
    expect(lines[0]).toContain('429')
    expect(lines[1]).toContain('TypeError')
    for (const l of lines) expect(l).not.toMatch(/hunter2|a@b\.test/)
  } finally {
    spy.mockRestore()
  }
})

it("the caller's cookie is never forwarded", async () => {
  const { calls, handler } = fakeHandler(signedIn)
  await verifyPassword(incoming(), 'a@b.test', 'right', handler)
  expect(calls[0]!.headers.get('cookie')).toBeNull()
  expect(calls[1]!.headers.get('cookie')).not.toContain('callers-own')
})
