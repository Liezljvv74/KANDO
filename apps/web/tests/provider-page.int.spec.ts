import { createHash } from 'node:crypto'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { pool } from '@kando/db'
import { t } from '@kando/i18n'
import { cleanupUsers, seedBase, seedProvider } from './helpers'

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.7' }),
}))
process.env.NEON_AUTH_COOKIE_SECRET ||= 'test-secret-not-real'

const { default: ProviderPage, generateMetadata } =
  await import('../app/(site)/providers/[slug]/page')

const stamp = Date.now()
const BIO_DE = `Ich bin selbstständige Fotografin und fotografiere Hochzeiten und Familien in der ganzen Region (${stamp}).`
const BIO_EN = `I am a freelance photographer and I photograph weddings and families across the whole region (${stamp}).`
let categoryId: string
const hashes: string[] = []

async function provider(uid: string, bio: string, o: { status?: string; english?: boolean } = {}) {
  const id = await seedProvider(uid, { name: 'Anna Hübsch', categoryId, status: o.status })
  await pool.query('UPDATE providers SET bio = $1, experience = $2 WHERE id = $3', [
    bio,
    o.english
      ? `I have worked as a self-employed photographer since 2015 for many happy couples ${stamp}`
      : `Seit 2015 selbstständig ${stamp}`,
    id,
  ])
  await pool.query(
    "INSERT INTO services (provider_id, category_id, title, price_type, price, sort) VALUES ($1, $2, $3, 'from', 80, 1), ($1, $2, $4, 'on-request', NULL, 2)",
    [
      id,
      categoryId,
      o.english ? 'Wedding photography' : 'Hochzeit',
      o.english ? 'Consulting for couples' : 'Beratung',
    ],
  )
  return `${uid}-slug`
}

let deSlug: string, enSlug: string, draftSlug: string
beforeAll(async () => {
  ;({ categoryId } = await seedBase())
  await pool.query(
    "INSERT INTO category_texts (category_id, lang, name) VALUES ($1, 'de', $2), ($1, 'en', $3)",
    [categoryId, `Foto ${stamp}`, `Photo ${stamp}`],
  )
  deSlug = await provider('pg-de', BIO_DE)
  enSlug = await provider('pg-en', BIO_EN, { english: true })
  draftSlug = await provider('pg-draft', BIO_DE, { status: 'draft' })
})
afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.OPENROUTER_API_KEY
})
afterAll(async () => {
  await pool.query('DELETE FROM translations WHERE key = ANY($1)', [hashes])
  await pool.query(
    "DELETE FROM translation_requests WHERE client_key LIKE 'ip:%' AND created_at > now() - interval '1 minute'",
  )
  await cleanupUsers()
  await pool.query('DELETE FROM categories WHERE id = $1', [categoryId])
})

type Q = { lang?: string; translate?: string }
const args = (slug: string, q: Q = {}) => ({
  params: Promise.resolve({ slug }),
  searchParams: Promise.resolve(q),
})
const render = async (slug: string, q?: Q) =>
  renderToStaticMarkup(await ProviderPage(args(slug, q)))

describe('public provider page', () => {
  it('German default: headline, public name, category, price "ab 80,00 €", on request, place', async () => {
    const html = await render(deSlug)
    expect(html).toContain('Anna Hübsch')
    expect(html).toContain('von Anna Hübsch')
    expect(html).toContain(`Foto ${stamp}`)
    expect(html).toMatch(/ab\s80,00\s€/)
    expect(html).toContain('Preis auf Anfrage')
    expect(html).toContain('Berlin')
    expect(html).not.toContain('10115')
    expect(html).toContain(t('de', 'web.getApp'))
  })

  it('English with ?lang=en: "from €80.00"', async () => {
    const html = await render(deSlug, { lang: 'en' })
    expect(html).toContain('from €80.00')
    expect(html).toContain('Price on request')
    expect(html).toContain(`Photo ${stamp}`)
    expect(html).toContain('by Anna Hübsch')
    expect(html).toContain('Get the app')
  })

  it('escapes user content', async () => {
    await pool.query("UPDATE providers SET bio = '<script>alert(1)</script>' WHERE slug = $1", [
      deSlug,
    ])
    try {
      expect(await render(deSlug)).not.toContain('<script>alert')
    } finally {
      await pool.query('UPDATE providers SET bio = $1 WHERE slug = $2', [BIO_DE, deSlug])
    }
  })

  it('404 for a hidden provider (draft) and an unknown slug', async () => {
    await expect(render(draftSlug)).rejects.toThrow()
    await expect(render('nope')).rejects.toThrow()
    expect(await generateMetadata(args(draftSlug))).toEqual({})
  })

  it('metadata: title, description, canonical and hreflang for every language', async () => {
    const m = await generateMetadata(args(deSlug, { lang: 'en' }))
    expect(m.title).toBe(`Anna Hübsch – Anna Hübsch | ${t('de', 'brand.name')}`)
    expect(m.description).toBe(BIO_DE.slice(0, 155))
    expect(m.alternates?.canonical).toBe(`/providers/${deSlug}?lang=en`)
    expect(m.alternates?.languages).toEqual({
      de: `/providers/${deSlug}`,
      en: `/providers/${deSlug}?lang=en`,
      'x-default': `/providers/${deSlug}`,
    })
    expect(m.robots).toBeUndefined()
    expect((await generateMetadata(args(deSlug))).alternates?.canonical).toBe(
      `/providers/${deSlug}`,
    )
  })
})

describe('translate link', () => {
  it('is shown only when the texts are not in the page language', async () => {
    expect(await render(deSlug)).not.toContain(t('de', 'web.translate'))
    const en = await render(deSlug, { lang: 'en' })
    expect(en).toContain(t('en', 'web.translate'))
    expect(en).toContain('rel="nofollow"')
    expect(t('de', 'web.translate')).toBe('Übersetzen')
    expect(t('en', 'web.translate')).toBe('Translate')
    expect(en).toContain(`/providers/${deSlug}?lang=en&amp;translate=1`)
    expect(await render(enSlug, { lang: 'en' })).not.toContain(t('en', 'web.translate'))
    const de = await render(enSlug)
    expect(de).toContain(t('de', 'web.translate'))
    expect(de).toContain(`/providers/${enSlug}?translate=1`)
  })

  it('?translate=1 shows the translation with the AI label, noindex, canonical unchanged', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-not-real'
    vi.spyOn(global, 'fetch').mockImplementation(async (_u, init) => {
      const sent = JSON.parse(JSON.parse(String(init?.body)).messages.at(-1).content) as Record<
        string,
        string
      >
      for (const v of Object.values(sent)) hashes.push(createHash('sha256').update(v).digest('hex'))
      const out = Object.fromEntries(
        Object.entries(sent).map(([k, v]) => [k, k === 'bio' ? `TRANSLATED ${v}` : v]),
      )
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(out) } }] }),
      )
    })
    const html = await render(deSlug, { lang: 'en', translate: '1' })
    expect(html).toContain('TRANSLATED')
    expect(html).toContain('Automatically translated (AI) · Show original')
    expect(await render(deSlug, { translate: '1' })).not.toContain('Automatisch übersetzt') // already German: no label
    expect(`${t('de', 'web.translatedLabel')} · ${t('de', 'web.showOriginal')}`).toBe(
      'Automatisch übersetzt (KI) · Original anzeigen',
    )
    expect(html).not.toContain(t('en', 'web.translate'))
    const m = await generateMetadata(args(deSlug, { lang: 'en', translate: '1' }))
    expect(m.robots).toEqual({ index: false })
    expect(m.alternates?.canonical).toBe(`/providers/${deSlug}?lang=en`)
  })

  it('?translate=1 without a key shows the original texts and the unavailable copy', async () => {
    await pool.query('DELETE FROM translations WHERE key = ANY($1)', [hashes]) // nothing stored from the test above
    const html = await render(deSlug, { lang: 'en', translate: '1' })
    expect(html).toContain('Translation is not available right now.')
    expect(t('de', 'web.translationUnavailable')).toBe('Übersetzung ist gerade nicht verfügbar.')
    expect(html).toContain('selbstständige Fotografin')
    expect(html).not.toContain(t('en', 'web.translatedLabel'))
  })

  it('translate=1 on texts already in the viewer language: original, no label, no model call', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-not-real'
    const f = vi.spyOn(global, 'fetch')
    const html = await render(enSlug, { lang: 'en', translate: '1' })
    expect(f).not.toHaveBeenCalled()
    expect(html).toContain('freelance photographer')
    expect(html).not.toContain('Automatically translated')
    expect(html).not.toContain('Translate</a>')
  })
})
