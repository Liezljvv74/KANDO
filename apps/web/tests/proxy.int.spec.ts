import { NextRequest } from 'next/server'
import { expect, it, vi } from 'vitest'

const auth = vi.fn(() => new Response('auth'))
vi.mock('../lib/auth/server', () => ({ getAuth: () => ({ middleware: () => auth }) }))
const { proxy } = await import('../proxy')

const run = (path: string) => proxy(new NextRequest(`http://localhost${path}`))

it('/admin and below go through the auth middleware', async () => {
  for (const p of ['/admin', '/admin/sign-in']) expect(await (await run(p)).text(), p).toBe('auth')
})

it('/administrator or a page slug starting with admin is a site path with x-lang', async () => {
  const res = await run('/administrator?lang=en')
  expect(res.headers.get('x-middleware-request-x-lang')).toBe('en')
  expect((await run('/admin-info?lang=fr')).headers.get('x-middleware-request-x-lang')).toBe('de')
})
