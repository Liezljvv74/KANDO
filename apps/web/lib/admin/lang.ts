import { acceptLang, DEFAULT_LANG, isLang, type Lang } from '@kando/i18n'

/** Back office language: the admin-lang cookie, else the browser's Accept-Language, else the default. */
export function adminLang({ cookie, acceptLanguage }: { cookie?: string; acceptLanguage?: string | null }): Lang {
  if (isLang(cookie)) return cookie
  return acceptLang(acceptLanguage) ?? DEFAULT_LANG
}

/** The cookie the language switch writes: one year, whole site. */
export const adminLangCookie = (lang: Lang) => `admin-lang=${lang}; path=/; max-age=31536000; SameSite=Lax`

/** Browser side (no request headers): the admin-lang cookie from document.cookie, else navigator.languages, else the default. */
export function browserAdminLang(cookie: string, languages: readonly string[]): Lang {
  return adminLang({ cookie: /(?:^|;\s*)admin-lang=([^;]*)/.exec(cookie)?.[1], acceptLanguage: languages.join(',') })
}
