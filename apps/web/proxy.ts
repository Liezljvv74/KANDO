import { NextResponse, type NextRequest } from 'next/server'
import { DEFAULT_LANG, isLang } from '@kando/i18n'
import { getAuth } from './lib/auth/server'
import { siteLang } from './lib/site'

export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl
  if (pathname === '/admin' || pathname.startsWith('/admin/'))
    return getAuth().middleware({ loginUrl: '/admin/sign-in' })(request)
  const url = request.nextUrl.clone()
  // The public addresses keep ?lang=: a direct /en/x is sent to /x?lang=en, so each page has one address.
  const first = pathname.split('/')[1]
  if (isLang(first)) {
    url.pathname = pathname.slice(first.length + 1) || '/'
    url.searchParams.delete('lang')
    if (first !== DEFAULT_LANG) url.searchParams.set('lang', first)
    return NextResponse.redirect(url, 308)
  }
  // The website: /x?lang=en is rendered by /en/x (a rewrite, the address stays), so each language is a cached page.
  const lang = siteLang(searchParams.get('lang'))
  const translated = searchParams.get('translate') === '1' && /^\/providers\/[^/]+$/.test(pathname)
  url.pathname = `/${lang}${pathname === '/' ? '' : pathname}${translated ? '/translated' : ''}`
  url.search = ''
  return NextResponse.rewrite(url)
}

// Everything but the API routes, Next's own files, robots.txt and the sitemaps (*.xml).
export const config = {
  matcher: ['/((?!api/|app-api/|_next/|favicon.ico|robots.txt|[^/]+\\.xml$).*)'],
}
