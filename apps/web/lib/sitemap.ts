const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function urlset(urls: { loc: string; lastmod?: Date }[]): Response {
  const body = urls
    .map(
      (u) =>
        `<url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod.toISOString()}</lastmod>` : ''}</url>`,
    )
    .join('')
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`,
    {
      headers: { 'content-type': 'application/xml; charset=utf-8' },
    },
  )
}
