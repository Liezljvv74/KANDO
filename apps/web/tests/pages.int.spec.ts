import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, classifyTables, pool } from '@kando/db'
import { getPage, publishedPages } from '@kando/domain'
import { sql } from 'drizzle-orm'
import { renderMarkdown } from '../lib/markdown'

const { default: PageBySlug, generateMetadata } = await import('../app/(site)/[lang]/[slug]/page')

const stamp = Date.now()
const slug = (n: string) => `pg-${n}-${stamp}`
const ids: string[] = []

async function seed(
  name: string,
  o: { published?: boolean; de?: [string, string]; en?: [string, string] },
) {
  const r = await pool.query('INSERT INTO pages (slug, published) VALUES ($1, $2) RETURNING id', [
    slug(name),
    o.published ?? true,
  ])
  ids.push(r.rows[0].id)
  for (const [lang, v] of [
    ['de', o.de],
    ['en', o.en],
  ] as const)
    if (v)
      await pool.query(
        'INSERT INTO page_texts (page_id, lang, title, body_markdown) VALUES ($1, $2, $3, $4)',
        [r.rows[0].id, lang, v[0], v[1]],
      )
}

beforeAll(async () => {
  await seed('both', {
    de: ['Datenschutz Test', '# Überschrift\n\nText **fett**'],
    en: ['Privacy Test', 'English *text*'],
  })
  await seed('deonly', { de: ['Nur Deutsch', 'Deutscher Text'] })
  await seed('draft', { published: false, de: ['Entwurf', 'geheim'] })
  await seed('evil', {
    de: [
      'Böse',
      '<script>alert(1)</script>\n\n<img src=x onerror=alert(2)>\n\n[klick](javascript:alert(3)) und [ok](https://example.com/a)',
    ],
  })
})
afterAll(async () => {
  await pool.query('DELETE FROM pages WHERE id = ANY($1)', [ids])
})

const render = async (s: string, lang?: string) =>
  renderToStaticMarkup(
    await PageBySlug({ params: Promise.resolve({ slug: s, lang: lang ?? 'de' }) }),
  )

describe('pages tables', () => {
  it('every table is classified (pages and page_texts are public reference tables)', () => {
    expect(classifyTables()).toEqual({ unclassified: [], duplicated: [] })
  })

  it('app requests see published pages and their texts only; the owner connection sees drafts too', async () => {
    const pagesSeen = async (uid: string | null) =>
      (await asUser(uid, (tx) => tx.execute<{ slug: string }>(sql`SELECT slug FROM pages WHERE slug IN (${slug('both')}, ${slug('draft')})`))).rows.map((r) => r.slug)
    const textsSeen = async (uid: string | null) =>
      (await asUser(uid, (tx) => tx.execute(sql`SELECT t.title FROM page_texts t JOIN pages p ON p.id = t.page_id WHERE p.slug = ${slug('draft')}`))).rows.length
    const rawTexts = async () =>
      (await pool.query('SELECT 1 FROM page_texts t JOIN pages p ON p.id = t.page_id WHERE p.slug = $1', [slug('draft')])).rows.length
    expect(await pagesSeen(null)).not.toContain(slug('draft'))
    expect(await pagesSeen('u1')).not.toContain(slug('draft'))
    expect(await pagesSeen(null)).toContain(slug('both'))
    expect(await rawTexts()).toBeGreaterThan(0) // the draft has texts on the owner connection ...
    expect(await textsSeen(null)).toBe(0) // ... and none for the public
    expect((await pool.query('SELECT slug FROM pages WHERE slug = $1', [slug('draft')])).rows).toHaveLength(1)
  })

  it('anonymous app requests read pages but cannot write them', async () => {
    const rows = await asUser(null, (tx) =>
      tx.execute(sql`SELECT slug FROM pages WHERE slug = ${slug('both')}`),
    )
    expect(rows.rows).toHaveLength(1)
    const denied = { cause: { message: expect.stringContaining('permission denied') } }
    await expect(
      asUser(null, (tx) => tx.execute(sql`INSERT INTO pages (slug) VALUES ('x-denied')`)),
    ).rejects.toMatchObject(denied)
    await expect(
      asUser('u1', (tx) => tx.execute(sql`UPDATE page_texts SET title = 'x'`)),
    ).rejects.toMatchObject(denied)
    await expect(asUser('u1', (tx) => tx.execute(sql`DELETE FROM pages`))).rejects.toMatchObject(
      denied,
    )
  })
})

describe('getPage', () => {
  it('returns the text in the language, falls back to de, hides drafts and unknown slugs', async () => {
    expect(await asUser(null, (tx) => getPage(tx, slug('both'), 'en'))).toMatchObject({
      title: 'Privacy Test',
      bodyMarkdown: 'English *text*',
    })
    expect(await asUser(null, (tx) => getPage(tx, slug('both'), 'de'))).toMatchObject({
      title: 'Datenschutz Test',
    })
    expect(await asUser(null, (tx) => getPage(tx, slug('deonly'), 'en'))).toMatchObject({
      title: 'Nur Deutsch',
    })
    expect(await asUser(null, (tx) => getPage(tx, slug('draft'), 'de'))).toBeNull()
    expect(await asUser(null, (tx) => getPage(tx, 'nope', 'de'))).toBeNull()
  })

  it('publishedPages lists published pages only', async () => {
    const list = (await asUser(null, (tx) => publishedPages(tx))).map((p) => p.slug)
    expect(list).toContain(slug('both'))
    expect(list).not.toContain(slug('draft'))
  })
})

describe('legal page by slug', () => {
  it('renders the Markdown body in both languages with the de fallback', async () => {
    const de = await render(slug('both'))
    expect(de).toContain('Datenschutz Test')
    expect(de).toContain('<strong>fett</strong>')
    const en = await render(slug('both'), 'en')
    expect(en).toContain('Privacy Test')
    expect(en).toContain('<em>text</em>')
    expect(await render(slug('deonly'), 'en')).toContain('Nur Deutsch')
  })

  it('404 for unknown and unpublished slugs', async () => {
    await expect(render('nope')).rejects.toThrow()
    await expect(render(slug('draft'))).rejects.toThrow()
  })

  it('metadata: title, canonical and hreflang for every language', async () => {
    const m = await generateMetadata({
      params: Promise.resolve({ slug: slug('both'), lang: 'en' }),
    })
    expect(m.title).toBe('Privacy Test')
    expect(m.alternates?.canonical).toBe(`/${slug('both')}?lang=en`)
    expect(m.alternates?.languages).toEqual({
      de: `/${slug('both')}`,
      en: `/${slug('both')}?lang=en`,
      'x-default': `/${slug('both')}`,
    })
    expect(
      await generateMetadata({
        params: Promise.resolve({ slug: 'nope', lang: 'de' }),
      }),
    ).toEqual({})
  })

  it('escapes HTML in a body and drops unsafe links', async () => {
    const html = await render(slug('evil'))
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('href="https://example.com/a"')
  })
})

describe('renderMarkdown', () => {
  it('escapes raw html and keeps Markdown', () => {
    expect(renderMarkdown('<script>x</script>')).not.toContain('<script')
    expect(renderMarkdown('- a\n- b')).toContain('<li>a</li>')
  })

  it('external links get rel="nofollow ugc"; protocol-relative and backslash paths are dropped', () => {
    expect(renderMarkdown('[a](https://example.com)')).toContain('rel="nofollow ugc"')
    expect(renderMarkdown('[a](/agb)')).not.toContain('rel=')
    expect(renderMarkdown('[a](//evil.example)')).not.toContain('href')
    expect(renderMarkdown('[a](/\\\\evil.example)')).not.toContain('href')
  })
})
