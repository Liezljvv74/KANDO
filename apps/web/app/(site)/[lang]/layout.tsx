import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { t } from '@kando/i18n'
import { Footer } from '../../../components/footer'
import { langPath, pageLang, siteUrl } from '../../../lib/site'
import '../../globals.css'

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
    <html lang={lang}>
      <body className="flex min-h-screen flex-col bg-white">
        <header className="mx-auto w-full max-w-5xl px-4 py-6">
          <Link href={langPath('/', lang)} className="text-xl font-extrabold">
            {t(lang, 'brand.name')}
          </Link>
        </header>
        {children}
        <Footer lang={lang} />
      </body>
    </html>
  )
}
