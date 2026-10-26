import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import Link from 'next/link'
import { t } from '@kando/i18n'
import { Footer } from '../../components/footer'
import { langPath, siteLang } from '../../lib/site'
import '../globals.css'

// The root layout of the website. The proxy puts the ?lang= language on the request as x-lang.
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const lang = siteLang((await headers()).get('x-lang'))
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
