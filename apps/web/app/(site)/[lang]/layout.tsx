import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Courier_Prime, Fraunces } from 'next/font/google'
import Image from 'next/image'
import Link from 'next/link'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { t } from '@kando/i18n'
import { Footer } from '@/components/footer'
import logo from '@/components/kando-logo.png' // the KANDO logo with the white background removed (Marketing/Kando Logo.png)
import { langPath, pageLang, siteUrl } from '@/lib/site'
import '../../globals.css'

// The app's two type faces (Fraunces for headlines, Courier Prime for stamps).
const heading = Fraunces({ subsets: ['latin'], weight: ['700', '900'], variable: '--font-heading', display: 'swap' })
const tag = Courier_Prime({ subsets: ['latin'], weight: '700', variable: '--font-tag', display: 'swap' })

export const metadata: Metadata = { metadataBase: new URL(siteUrl()) }

// Nothing is rendered at build (no database there): each page is rendered on its first visit and then cached.
export async function generateStaticParams() {
  return []
}

// The root layout of the website. The proxy rewrites /x?lang=en to /en/x, so the language is a path segment.
export default async function SiteLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ lang: string }>
}) {
  const lang = await pageLang(params)
  return (
    <html lang={lang} className={`${heading.variable} ${tag.variable}`}>
      <body className="flex min-h-screen flex-col bg-mint-50">
        {/* -mb-px: the logo makes the header's height a fraction of a pixel; the block below overlaps it by one pixel so no hairline shows between two same-coloured blocks. */}
        <header className="-mb-px bg-brand">
          <div className="mx-auto w-full max-w-5xl px-4 py-4">
            <Link href={langPath('/', lang)} className="inline-flex flex-col gap-2 font-heading text-2xl font-black text-teal" style={{ fontFamily: 'var(--font-heading), Georgia, serif' }}>
              {t(lang, 'brand.name')}
              {/* The logo under the word, as wide as the word: this box has no width of its own (the picture is placed inside it), so the word sets the width. Decorative: the word is the link's name. */}
              <span className="relative block w-full" style={{ aspectRatio: '480 / 509' }}>
                <Image src={logo} alt="" fill sizes="120px" priority className="object-contain" />
              </span>
            </Link>
          </div>
        </header>
        {children}
        <Footer lang={lang} />
        {/* Vercel's own page-view and speed measuring: the only analytics on the site. Not in the back office (app/admin). */}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
