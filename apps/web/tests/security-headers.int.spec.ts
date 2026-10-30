import { afterEach, expect, it, vi } from 'vitest'
import nextConfig from '../next.config'

it('every route gets the security headers, and the server does not announce itself', async () => {
  expect(nextConfig.poweredByHeader).toBe(false)
  const rules = await nextConfig.headers!()
  expect(rules).toHaveLength(1)
  expect(rules[0]!.source).toBe('/:path*')
  expect(Object.fromEntries(rules[0]!.headers.map((h) => [h.key, h.value]))).toEqual({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'X-Frame-Options': 'DENY',
    // Enforced: frame-ancestors, object-src, base-uri only (no form-action or script-src, they could break the Neon Auth redirects); script-src is only a report-only trial below
    'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
    'Content-Security-Policy-Report-Only': "script-src 'self' 'unsafe-inline'",
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

it('development adds unsafe-eval to the trial policy only', async () => {
  vi.stubEnv('NODE_ENV', 'development')
  vi.resetModules()
  const dev = (await import('../next.config')).default
  const h = Object.fromEntries((await dev.headers!())[0]!.headers.map((x) => [x.key, x.value]))
  expect(h['Content-Security-Policy-Report-Only']).toBe("script-src 'self' 'unsafe-inline' 'unsafe-eval'")
  expect(h['Content-Security-Policy']).toBe("frame-ancestors 'none'; object-src 'none'; base-uri 'self'")
})
