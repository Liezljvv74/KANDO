import { NextRequest } from 'next/server'
import {
  getRedirectUrl,
  getRewrittenUrl,
  unstable_doesMiddlewareMatch,
} from 'next/experimental/testing/server'
import { expect, it, vi } from 'vitest'

const auth = vi.fn(() => new Response('auth'))
vi.mock('../lib/auth/server', () => ({ getAuth: () => ({ middleware: () => auth }) }))
const { proxy, config } = await import('../proxy')

const run = (path: string) => proxy(new NextRequest(`http://localhost${path}`))
const rewrite = async (path: string) => {
  const to = getRewrittenUrl(await run(path))
  return to && new URL(to).pathname
}

it('/admin and below go through the auth middleware', async () => {
  for (const p of ['/admin', '/admin/sign-in']) expect(await (await run(p)).text(), p).toBe('auth')
})

it('a site path is rewritten to its language segment; ?lang=en to /en', async () => {
  expect(await rewrite('/')).toBe('/de')
  expect(await rewrite('/?lang=en')).toBe('/en')
  expect(await rewrite('/providers/anna?lang=en')).toBe('/en/providers/anna')
  expect(await rewrite('/impressum')).toBe('/de/impressum')
  // unknown or repeated ?lang= is German, as before
  expect(await rewrite('/agb?lang=fr')).toBe('/de/agb')
  expect(await rewrite('/agb?lang=en&lang=en')).toBe('/en/agb')
  // /administrator or a page slug starting with admin is a site path
  expect(await rewrite('/administrator?lang=en')).toBe('/en/administrator')
  expect(await rewrite('/admin-info')).toBe('/de/admin-info')
  // the x-lang request header is gone
  expect((await run('/?lang=en')).headers.get('x-middleware-request-x-lang')).toBeNull()
})

it('?translate=1 goes to the translated page', async () => {
  expect(await rewrite('/providers/anna?lang=en&translate=1')).toBe(
    '/en/providers/anna/translated',
  )
  expect(await rewrite('/providers/anna?translate=1')).toBe('/de/providers/anna/translated')
  // only on a provider page
  expect(await rewrite('/impressum?translate=1')).toBe('/de/impressum')
})

it('sitemaps and robots.txt are not rewritten', () => {
  const matches = (path: string) =>
    unstable_doesMiddlewareMatch({ config, url: `http://localhost${path}` })
  for (const p of ['/robots.txt', '/pages-sitemap.xml', '/providers-sitemap.xml'])
    expect(matches(p), p).toBe(false)
  for (const p of ['/api/x', '/app-api/v1/x', '/_next/static/x.js', '/favicon.ico'])
    expect(matches(p), p).toBe(false)
  for (const p of ['/', '/impressum', '/providers/anna', '/admin', '/xml-guide'])
    expect(matches(p), p).toBe(true)
})

it('a direct /en/ path redirects to ?lang=en', async () => {
  const to = async (path: string) => {
    const r = await run(path)
    expect(r.status, path).toBe(308)
    const u = new URL(getRedirectUrl(r)!)
    return u.pathname + u.search
  }
  expect(await to('/en/providers/anna')).toBe('/providers/anna?lang=en')
  expect(await to('/en')).toBe('/?lang=en')
  expect(await to('/de/impressum?lang=en')).toBe('/impressum')
  expect(await to('/en/providers/anna?translate=1')).toBe('/providers/anna?translate=1&lang=en')
})
