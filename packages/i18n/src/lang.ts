// Languages, locales and the Accept-Language parser. Imports no catalogue, so anything may use it without pulling texts in.
export type Lang = 'de' | 'en'
export const LANGS: readonly Lang[] = ['de', 'en']
export const DEFAULT_LANG = 'de' satisfies Lang
export const isLang = (v: unknown): v is Lang => LANGS.includes(v as Lang)

/** The first supported language of an Accept-Language header, in header order. */
export function acceptLang(header: string | null | undefined): Lang | undefined {
  for (const part of (header ?? '').split(',')) {
    const tag = part.split(';')[0]!.trim().toLowerCase().split('-')[0]
    if (isLang(tag)) return tag
  }
  return undefined
}

export const LOCALE: Record<Lang, string> = { de: 'de-DE', en: 'en-GB' }

/** The time zone dates in emails are shown in (the server runs in UTC); one place to change per country. */
export const TIME_ZONE = 'Europe/Berlin'
