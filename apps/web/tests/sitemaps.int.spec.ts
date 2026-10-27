import { afterAll, beforeAll, expect, it } from 'vitest'
import { pool } from '@kando/db'
import { cleanupUsers, seedBase, seedProvider } from './helpers'

const { GET: providers } = await import('../app/(site)/providers-sitemap.xml/route')
const { GET: pages } = await import('../app/(site)/pages-sitemap.xml/route')
const { default: robots } = await import('../app/robots')

const stamp = Date.now()
const ids: string[] = []
beforeAll(async () => {
  const { categoryId, docCategoryId } = await seedBase()
  await seedProvider('sm-live', { name: 'Live', categoryId })
  await seedProvider('sm-draft', { name: 'Draft', categoryId, status: 'draft' })
  await seedProvider('sm-susp', { name: 'Susp', categoryId, suspended: true })
  await seedProvider('sm-nodocs', { name: 'NoDocs', categoryId: docCategoryId })
  for (const [s, published] of [
    [`sm-pub-${stamp}`, true],
    [`sm-hidden-${stamp}`, false],
  ] as const)
    ids.push(
      (
        await pool.query('INSERT INTO pages (slug, published) VALUES ($1, $2) RETURNING id', [
          s,
          published,
        ])
      ).rows[0].id,
    )
})
afterAll(async () => {
  await pool.query('DELETE FROM pages WHERE id = ANY($1)', [ids])
  await cleanupUsers()
})

it('providers sitemap lists only visible providers', async () => {
  const res = await providers()
  expect(res.headers.get('content-type')).toContain('xml')
  const xml = await res.text()
  expect(xml).toContain('<urlset')
  expect(xml).toContain('/providers/sm-live-slug</loc>')
  for (const s of ['sm-draft-slug', 'sm-susp-slug', 'sm-nodocs-slug'])
    expect(xml, s).not.toContain(s)
})

it('pages sitemap lists the home page and published pages only', async () => {
  const xml = await (await pages()).text()
  expect(xml).toContain(`/sm-pub-${stamp}</loc>`)
  expect(xml).not.toContain(`sm-hidden-${stamp}`)
  expect(xml).toMatch(/<loc>[^<]+\/<\/loc>/)
})

it('robots.txt allows the site, keeps the admin out and points at both sitemaps', () => {
  const r = robots()
  expect(r.sitemap).toEqual([
    expect.stringMatching(/\/pages-sitemap\.xml$/),
    expect.stringMatching(/\/providers-sitemap\.xml$/),
  ])
  expect(JSON.stringify(r.rules)).toContain('/admin')
})
