import { asUser } from '@kando/db'
import { visibleProviderSlugs } from '@kando/domain'
import { siteUrl } from '../../../lib/site'
import { urlset } from '../../../lib/sitemap'

export const dynamic = 'force-dynamic'

export async function GET() {
  const rows = await asUser(null, visibleProviderSlugs)
  return urlset(
    rows.map((r) => ({
      loc: `${siteUrl()}/providers/${encodeURIComponent(r.slug)}`,
      lastmod: r.updatedAt,
    })),
  )
}
