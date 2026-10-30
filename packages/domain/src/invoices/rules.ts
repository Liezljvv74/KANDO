import type { Lang } from '@kando/i18n'

// All wording in this folder must be checked by a tax adviser before launch (README launch item).

/** VAT rate by country. A missing country throws (known debt for the second market). */
export const VAT_RATES: Record<string, number> = { DE: 0.19 }

export function vatRate(country: string): number {
  const rate = VAT_RATES[country]
  if (rate === undefined) throw new Error(`no VAT rate for country ${country}`)
  return rate
}

/** The small business (Kleinunternehmer) note, section 19 UStG. */
export const S19_NOTE: Record<Lang, string> = {
  de: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
  en: 'No VAT is charged under section 19 UStG (small business rule).',
}

/** "Issued in the name and for the account of <provider> by <product>", German then English. */
export const onBehalfNote = (provider: string, product: string): string =>
  `Ausgestellt im Namen und für Rechnung von ${provider} durch ${product} / Issued in the name and for the account of ${provider} by ${product}`
