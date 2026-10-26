export const LANGS = ['de', 'en'] as const
export type Lang = (typeof LANGS)[number]
export const DEFAULT_LANG: Lang = 'de'
export const isLang = (v: unknown): v is Lang => LANGS.includes(v as Lang)
