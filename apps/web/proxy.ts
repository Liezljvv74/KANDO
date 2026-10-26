import type { NextRequest } from 'next/server'
import { getAuth } from './lib/auth/server'

export function proxy(request: NextRequest) {
  return getAuth().middleware({ loginUrl: '/admin/sign-in' })(request)
}

export const config = { matcher: ['/admin/:path*'] }
