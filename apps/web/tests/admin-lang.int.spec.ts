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

const { adminLang, adminLangCookie } = await import('../lib/admin/lang')
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
