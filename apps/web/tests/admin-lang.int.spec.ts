import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { en } from '@kando/i18n/src/en'
import { de } from '@kando/i18n/src/de'

const jar = vi.hoisted(() => ({ cookie: undefined as string | undefined, accept: undefined as string | undefined }))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (n === 'admin-lang' && jar.cookie ? { value: jar.cookie } : undefined) }),
  headers: async () => ({ get: (n: string) => (n === 'accept-language' ? (jar.accept ?? null) : null) }),
}))

vi.mock('@neondatabase/auth/next', () => ({
  createAuthClient: () => ({ signIn: { email: async () => ({ error: { message: 'bad' } }) }, signOut: async () => ({}) }),
}))

const { adminLang, adminLangCookie, browserAdminLang } = await import('../lib/admin/lang')
const { AdminLangProvider, useAt } = await import('../lib/admin/t')
const { default: AdminLayout } = await import('../app/admin/layout')

describe('adminLang', () => {
  it.each([
    [{ cookie: 'en' }, 'en'],
    [{ cookie: 'fr' }, 'de'],
    [{ cookie: 'xx', acceptLanguage: 'en' }, 'en'],
    [{ acceptLanguage: 'en-GB,en;q=0.9,de;q=0.8' }, 'en'],
    [{ acceptLanguage: 'fr-FR' }, 'de'],
    [{}, 'de'],
  ] as const)('%j -> %s', (input, lang) => expect(adminLang(input)).toBe(lang))
})

describe('browserAdminLang', () => {
  it('cookie en wins, then the browser languages, then de', () => {
    expect(browserAdminLang('a=1; admin-lang=en', ['de-DE'])).toBe('en')
    expect(browserAdminLang('admin-lang=xx', ['fr', 'en-GB'])).toBe('en')
    expect(browserAdminLang('', ['en-US'])).toBe('en')
    expect(browserAdminLang('', ['fr'])).toBe('de')
    expect(browserAdminLang('', [])).toBe('de')
  })
})

describe('login failure text', () => {
  it('follows admin-lang=en', async () => {
    vi.stubGlobal('document', { cookie: 'admin-lang=en' })
    vi.stubGlobal('navigator', { languages: ['de-DE'] })
    vi.stubGlobal('fetch', vi.fn())
    const { authProvider } = await import('../lib/admin/auth-provider')
    const res = (await authProvider.login({ email: 'a@b.c', password: 'x' })) as { error: { message: string } }
    expect(res.error.message).toBe(en['admin.signIn.failed'])
    vi.stubGlobal('document', { cookie: '' })
    const de2 = (await authProvider.login({ email: 'a@b.c', password: 'x' })) as { error: { message: string } }
    expect(de2.error.message).toBe(de['admin.signIn.failed'])
    vi.unstubAllGlobals()
  })
})

describe('adminLangCookie', () => {
  it('lasts a year for the whole site', () =>
    expect(adminLangCookie('en')).toBe('admin-lang=en; path=/; max-age=31536000; SameSite=Lax'))
})

describe('useAt', () => {
  const Heading = () => createElement('h1', null, useAt()('admin.signIn.title'))
  it.each([
    ['en', en['admin.signIn.title']],
    ['de', de['admin.signIn.title']],
  ] as const)('renders %s', (lang, text) =>
    expect(renderToStaticMarkup(createElement(AdminLangProvider, { value: lang }, createElement(Heading)))).toContain(text))
})

describe('admin layout', () => {
  async function htmlLang(cookie?: string, accept?: string) {
    jar.cookie = cookie
    jar.accept = accept
    const el = await AdminLayout({ children: null })
    return (el as { props: { lang: string; translate: string } }).props
  }
  it('follows the cookie, then Accept-Language, then German', async () => {
    expect((await htmlLang('en')).lang).toBe('en')
    expect((await htmlLang('en')).translate).toBe('no')
    expect((await htmlLang(undefined, 'en')).lang).toBe('en')
    expect((await htmlLang(undefined, 'de')).lang).toBe('de')
    expect((await htmlLang()).lang).toBe('de')
  })
})
