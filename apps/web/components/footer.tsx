import Link from 'next/link'
import { t, type Key, type Lang } from '@kando/i18n'
import { langPath } from '../lib/site'

// Legal pages are written by staff under these slugs.
const LEGAL: [string, Key][] = [
  ['/impressum', 'web.footer.impressum'],
  ['/datenschutz', 'web.footer.privacy'],
  ['/agb', 'web.footer.terms'],
  ['/ranking', 'web.footer.ranking'],
]

export function Footer({ lang }: { lang: Lang }) {
  return (
    <footer className="mt-auto bg-ink text-mint-200">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8 md:flex-row md:items-center md:justify-between">
        <Link href={langPath('/', lang)} className="font-bold text-white">
          {t(lang, 'brand.name')}
        </Link>
        <nav className="flex flex-wrap gap-4 text-sm">
          {LEGAL.map(([href, key]) => (
            <Link key={href} href={langPath(href, lang)} className="hover:text-white">
              {t(lang, key)}
            </Link>
          ))}
        </nav>
      </div>
      <p className="mx-auto max-w-5xl px-4 pb-6 text-sm opacity-70">
        {t(lang, 'web.footer.credit')}
      </p>
    </footer>
  )
}
