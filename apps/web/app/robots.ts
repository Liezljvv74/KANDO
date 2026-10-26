import type { MetadataRoute } from 'next'
import { siteUrl } from '../lib/site'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/admin', '/api/', '/app-api/'] },
    sitemap: [`${siteUrl()}/pages-sitemap.xml`, `${siteUrl()}/providers-sitemap.xml`],
  }
}
