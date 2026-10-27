import { de } from './de'
import { en } from './en'

export type Lang = 'de' | 'en'
export const LANGS: readonly Lang[] = ['de', 'en']
export const DEFAULT_LANG = 'de' satisfies Lang
export const isLang = (v: unknown): v is Lang => LANGS.includes(v as Lang)

export type Key = keyof typeof de

const catalogue: Record<Lang, Record<Key, string>> = { de, en }

/** `{name}` placeholders come from `params`; `{brand}` is always filled. A key missing at runtime is returned as is. */
export function t(lang: Lang, key: Key, params: Record<string, string | number> = {}): string {
  const text: string | undefined = catalogue[lang][key]
  const all: Record<string, string | number> = { brand: de['brand.name'], ...params }
  return (text ?? key).replace(/\{(\w+)\}/g, (m, name: string) =>
    name in all ? String(all[name]) : m,
  )
}

export const LOCALE: Record<Lang, string> = { de: 'de-DE', en: 'en-GB' }

export const formatMoney = (amount: number, currency: string, lang: Lang): string =>
  new Intl.NumberFormat(LOCALE[lang], { style: 'currency', currency }).format(amount)

export type PriceType = 'fixed' | 'hourly' | 'from' | 'on-request'

/** The price label of a service, e.g. "ab 20,00 €", "35,50 €/Std.", "Preis auf Anfrage". */
export function formatPrice(
  priceType: PriceType,
  amount: number | null,
  currency: string,
  lang: Lang,
): string {
  if (priceType === 'on-request' || amount === null) return t(lang, 'price.onRequest')
  const money = formatMoney(amount, currency, lang)
  if (priceType === 'from') return `${t(lang, 'price.from')} ${money}`
  if (priceType === 'hourly') return `${money}${t(lang, 'price.perHour')}`
  return money
}
