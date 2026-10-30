import type { NextConfig } from 'next'

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
  // Report-only trial: fixed policy, not nonces (nonces force per-request rendering and undo cached public pages).
  // ponytail: nonce policy for /admin (already per request) when an inline-script risk appears there.
  {
    key: 'Content-Security-Policy-Report-Only',
    value: `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
  },
  // No preload: hard to undo. skillweb.space serves only the apex and www, both HTTPS on Vercel.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
]

const nextConfig: NextConfig = {
  poweredByHeader: false,
  headers: async () => [{ source: '/:path*', headers: securityHeaders }],
}

export default nextConfig
