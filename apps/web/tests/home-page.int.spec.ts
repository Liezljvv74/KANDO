import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { t } from '@kando/i18n'

// The layout reads the language the proxy put on the request.
let headerLang: string | undefined
vi.mock('next/headers', () => ({
  headers: async () => new Headers(headerLang ? { 'x-lang': headerLang } : {}),
}))

process.env.NEXT_PUBLIC_SERVER_URL = 'https://kando.example'
const { default: HomePage, generateMetadata } = await import('../app/(site)/page')
const { default: Layout, metadata } = await import('../app/(site)/layout')

const stamp = Date.now()
let categoryId: string
beforeAll(async () => {
  const c = await pool.query('INSERT INTO categories (slug) VALUES ($1) RETURNING id', [
    `home-${stamp}`,
  ])
  categoryId = c.rows[0].id
  await pool.query(
    "INSERT INTO category_texts (category_id, lang, name) VALUES ($1, 'de', $2), ($1, 'en', $3)",
    [categoryId, `Gassi ${stamp}`, `Dog walking ${stamp}`],
  )
})
afterAll(async () => {
  await pool.query('DELETE FROM categories WHERE id = $1', [categoryId])
})

const render = async (lang?: string) =>
  renderToStaticMarkup(await HomePage({ searchParams: Promise.resolve({ lang }) }))

describe('home page', () => {
  it('is German by default: headline, categories, store badges without links, no forbidden words', async () => {
    const html = await render()
    expect(html).toContain('Endlich jemand, der’s kann')
    expect(html).toContain(`Gassi ${stamp}`)
    expect(html).toContain('Bald verfügbar')
    expect(html).toContain('App Store')
    expect(html).toContain('Google Play')
    expect(html).not.toContain('apps.apple.com')
    for (const word of ['treuhand', 'escrow', 'garantiert', 'payload'])
      expect(html.toLowerCase(), word).not.toContain(word)
  })

  it('switches to English with ?lang=en and falls back to German for unknown values', async () => {
    const en = await render('en')
    expect(en).toContain(t('en', 'home.headline'))
    expect(en).toContain(`Dog walking ${stamp}`)
    expect(en).toContain(t('en', 'home.soon'))
    expect(en).not.toContain('Endlich jemand')
    expect(await render('fr')).toContain('Endlich jemand, der’s kann')
  })

  it('has per-language metadata with canonical and hreflang for every language', async () => {
    const de = await generateMetadata({ searchParams: Promise.resolve({}) })
    const en = await generateMetadata({ searchParams: Promise.resolve({ lang: 'en' }) })
    expect(de.title).toBe(t('de', 'home.metaTitle'))
    expect(en.title).toBe(t('en', 'home.metaTitle'))
    expect(de.alternates?.canonical).toBe('/')
    expect(en.alternates?.canonical).toBe('/?lang=en')
    expect(de.alternates?.languages).toEqual({ de: '/', en: '/?lang=en', 'x-default': '/' })
  })
})

describe('site layout', () => {
  it('metadataBase makes canonical and hreflang absolute on the site url', async () => {
    expect(String(metadata.metadataBase)).toBe('https://kando.example/')
    const en = await generateMetadata({ searchParams: Promise.resolve({ lang: 'en' }) })
    const urls = [
      en.alternates!.canonical as string,
      ...Object.values(en.alternates!.languages as Record<string, string>),
    ]
    for (const u of urls)
      expect(new URL(u, metadata.metadataBase!).href).toMatch(/^https:\/\/kando\.example\//)
  })

  const layout = async (lang?: string) => {
    headerLang = lang
    return renderToStaticMarkup(await Layout({ children: 'BODY' }))
  }

  it('html lang follows the request language; unknown falls back to de', async () => {
    expect(await layout()).toContain('<html lang="de"')
    expect(await layout('en')).toContain('<html lang="en"')
    expect(await layout('fr')).toContain('<html lang="de"')
  })

  it('footer links the four legal pages with catalogue labels in both languages', async () => {
    for (const lang of ['de', 'en'] as const) {
      const html = await layout(lang)
      const q = lang === 'en' ? '?lang=en' : ''
      for (const [slug, key] of [
        ['impressum', 'web.footer.impressum'],
        ['datenschutz', 'web.footer.privacy'],
        ['agb', 'web.footer.terms'],
        ['ranking', 'web.footer.ranking'],
      ] as const)
        expect(html).toMatch(
          new RegExp(`<a [^>]*href="/${slug}${q.replace('?', '\\?')}">${t(lang, key)}</a>`),
        )
    }
  })
})
