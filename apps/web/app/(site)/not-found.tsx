import { headers } from 'next/headers'
import Link from 'next/link'
import { t } from '@kando/i18n'
import { langPath, siteLang } from '../../lib/site'

export default async function NotFound() {
  const lang = siteLang((await headers()).get('x-lang'))
  return (
    <main className="mx-auto max-w-3xl px-4 py-20">
      <h1 className="text-3xl font-extrabold">404</h1>
      <p className="mt-2">{t(lang, 'web.notFound')}</p>
      <Link href={langPath('/', lang)} className="mt-4 inline-block underline">
        {t(lang, 'web.backHome')}
      </Link>
    </main>
  )
}
