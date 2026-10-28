import { expect, it } from 'vitest'
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
    // frame-ancestors only: no form-action or script-src, they could break the Neon Auth redirects
    'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  })
})
