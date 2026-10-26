import { asUser } from '@kando/db'
import { publishedPages } from '@kando/domain'
import { siteUrl } from '../../../lib/site'
import { urlset } from '../../../lib/sitemap'

export const dynamic = 'force-dynamic'

export async function GET() {
  const pages = await asUser(null, publishedPages)
  const base = siteUrl()
  return urlset(
    [`${base}/`, ...pages.map((p) => `${base}/${encodeURIComponent(p.slug)}`)].map((loc) => ({
      loc,
    })),
  )
}
