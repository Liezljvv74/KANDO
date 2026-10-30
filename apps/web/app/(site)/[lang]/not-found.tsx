import Link from 'next/link'
import { LANGS, t, type Lang } from '@kando/i18n'
import { langPath } from '../../../lib/site'
import { InLang } from './in-lang'

// A not-found file gets no params: both languages are rendered here and InLang shows the one in the path.
const Body = ({ lang }: { lang: Lang }) => (
  <main className="mx-auto max-w-3xl px-4 py-20">
    <h1 className="text-3xl font-extrabold">404</h1>
    <p className="mt-2">{t(lang, 'web.notFound')}</p>
    <Link href={langPath('/', lang)} className="mt-4 inline-block underline">
      {t(lang, 'web.backHome')}
    </Link>
  </main>
)

export default function NotFound() {
  return <InLang byLang={Object.fromEntries(LANGS.map((l) => [l, <Body key={l} lang={l} />]))} />
}
