import { type AppKey, interpolate } from './app'
import { de as appDe } from './de'
import { en as appEn } from './en'
import { de as serverDe } from './de-server'
import { en as serverEn } from './en-server'
import type { Lang } from './lang'

export * from './lang'
export { formatMoney, formatPrice, type AppKey, type PriceType } from './app'

export type Key = AppKey | keyof typeof serverDe
/** The raw catalogues, app and server texts merged (parity tests walk every key). */
export const de = { ...appDe, ...serverDe }
export const en = { ...appEn, ...serverEn }

const catalogue: Record<Lang, Record<Key, string>> = { de, en }

/** Like the app `t`, over every text including back-office and email. */
export const t = (lang: Lang, key: Key, params?: Record<string, string | number>): string =>
  interpolate(catalogue[lang][key], key, params)
