import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { Courier_Prime, Fraunces } from 'next/font/google'
import Link from 'next/link'
import { t } from '@kando/i18n'
import { Footer } from '@/components/footer'
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
        <header className="bg-brand">
          <div className="mx-auto w-full max-w-5xl px-4 py-4">
            <Link href={langPath('/', lang)} className="font-heading text-2xl font-black text-teal" style={{ fontFamily: 'var(--font-heading), Georgia, serif' }}>
              {t(lang, 'brand.name')}
            </Link>
          </div>
        </header>
        {children}
        <Footer lang={lang} />
      </body>
    </html>
  )
}
