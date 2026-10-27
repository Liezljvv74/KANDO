import { NextResponse, type NextRequest } from 'next/server'
import { getAuth } from './lib/auth/server'
import { siteLang } from './lib/site'

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (pathname === '/admin' || pathname.startsWith('/admin/'))
    return getAuth().middleware({ loginUrl: '/admin/sign-in' })(request)
  // The website: the root layout cannot see ?lang=, so the language travels as a request header (overwritten, never trusted from outside).
  const headers = new Headers(request.headers)
  headers.set('x-lang', siteLang(request.nextUrl.searchParams.get('lang')))
  return NextResponse.next({ request: { headers } })
}

// Everything but the API routes and Next's own files.
export const config = { matcher: ['/((?!api/|app-api/|_next/|favicon.ico).*)'] }
