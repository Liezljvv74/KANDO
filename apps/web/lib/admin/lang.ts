import { DEFAULT_LANG, isLang, type Lang } from '@kando/i18n'

/** Back office language: the admin-lang cookie, else the browser's Accept-Language, else the default. */
export function adminLang({ cookie, acceptLanguage }: { cookie?: string; acceptLanguage?: string | null }): Lang {
  if (cookie) return isLang(cookie) ? cookie : DEFAULT_LANG
  for (const part of (acceptLanguage ?? '').split(',')) {
    const code = part.split(';')[0]?.trim().slice(0, 2).toLowerCase()
    if (code && isLang(code)) return code
  }
  return DEFAULT_LANG
}
