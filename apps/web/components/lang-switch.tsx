import Link from 'next/link'
import { LANGS, t, type Lang } from '@kando/i18n'
import { langPath } from '../lib/site'

/** Link to the same page in the other language; its label ("English" / "Deutsch") comes from the current language's catalogue. */
export function LangSwitch({ lang, path }: { lang: Lang; path: string }) {
  const other = LANGS.find((l) => l !== lang)!
  return (
    <Link href={langPath(path, other)} hrefLang={other} className="text-sm font-semibold underline">
      {t(lang, 'web.switchLang')}
    </Link>
  )
}
