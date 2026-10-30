import type { Rating } from '@kando/contract'
import { formatPrice as priceLabel, type PriceType } from '@kando/i18n/app'

import { getLang, t } from '@/i18n'

/** Same rules as the website (shared catalogue): "ab 20,00 €", "20,00 €/Std.", "Preis auf Anfrage". */
export const formatPrice = (s: { priceType: PriceType; price: number | null; currency: string }): string =>
  priceLabel(s.priceType, s.price, s.currency, getLang())

/** "≈ 12 km", "remote" when no distance is known but the provider works remotely, else null. */
export function formatDistance(p: { distanceKm: number | null; worksRemotely: boolean }): string | null {
  if (p.distanceKm != null) return `≈ ${p.distanceKm} km`
  return p.worksRemotely ? t('distance.remote') : null
}

/** The badge on a card and the profile: "4,5 ★ (2)" once rated, else "New". */
export const ratingBadge = (rating: Rating | null | undefined): string =>
  rating ? t('search.rating', { average: rating.average.toLocaleString(getLang()), count: rating.count }) : t('badge.new')

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => Array.from(w)[0].toUpperCase())
    .join('')
