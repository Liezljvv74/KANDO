import { formatPrice as priceLabel, type PriceType } from '@kando/i18n'

import { getLang, t } from '@/i18n'

/** Same rules as the website (shared catalogue): "ab 20,00 €", "20,00 €/Std.", "Preis auf Anfrage". */
export const formatPrice = (s: { priceType: PriceType; price: number | null; currency: string }): string =>
  priceLabel(s.priceType, s.price, s.currency, getLang())

/** "≈ 12 km", "remote" when no distance is known but the provider works remotely, else null. */
export function formatDistance(p: { distanceKm: number | null; worksRemotely: boolean }): string | null {
  if (p.distanceKm != null) return `≈ ${p.distanceKm} km`
  return p.worksRemotely ? t('distance.remote') : null
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => Array.from(w)[0].toUpperCase())
    .join('')
