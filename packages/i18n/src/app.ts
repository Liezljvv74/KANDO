// The texts the apps (mobile and web pages) show. Back-office (admin.*) and email.* texts live in the server catalogues.
import { de } from './de'
import { en } from './en'
import type { Lang } from './lang'
import { LOCALE } from './lang'

export * from './lang'
export type AppKey = keyof typeof de

const catalogue: Record<Lang, Record<AppKey, string>> = { de, en }

/** `{name}` placeholders come from `params`; `{brand}` is always filled. A missing key is returned as is. */
export function interpolate(text: string | undefined, key: string, params: Record<string, string | number> = {}): string {
  const all: Record<string, string | number> = { brand: de['brand.name'], ...params }
  return (text ?? key).replace(/\{(\w+)\}/g, (m, name: string) => (name in all ? String(all[name]) : m))
}

export const t = (lang: Lang, key: AppKey, params?: Record<string, string | number>): string =>
  interpolate(catalogue[lang][key], key, params)

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
