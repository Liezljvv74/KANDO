import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DEFAULT_LANG, isLang, LANGS, type Lang } from '@kando/i18n'

/** The website language from `?lang=`; anything unknown (or repeated) is German. */
export const siteLang = (v: string | string[] | null | undefined): Lang =>
  isLang(v) ? v : DEFAULT_LANG

/** The language segment the proxy put in the path (/de, /en); anything else is 404. */
export async function pageLang(params: Promise<{ lang: string }>): Promise<Lang> {
  const { lang } = await params
  const valid = siteLang(lang)
  if (valid !== lang) notFound()
  return valid
}

export const langPath =(path: string, lang: Lang): string =>
  lang === DEFAULT_LANG ? path : `${path}?lang=${lang}`

/** Canonical (own language, never `translate`) and hreflang alternates for every language. */
export const alternates = (path: string, lang: Lang): NonNullable<Metadata['alternates']> => ({
  canonical: langPath(path, lang),
  languages: { ...Object.fromEntries(LANGS.map((l) => [l, langPath(path, l)])), 'x-default': path },
})

export function siteUrl(): string {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL
  return (
    process.env.NEXT_PUBLIC_SERVER_URL || (host ? `https://${host}` : 'http://localhost:3000')
  ).replace(/\/$/, '')
}
