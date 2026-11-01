import type { Booking } from '@kando/contract'

import { t } from '@/i18n'

/** Where the job is, in words: remote, on site with the address when there is one. `onSite` null (an old request) says nothing. */
export function placeText(onSite: boolean | null, address: Booking['address']): string | null {
  if (onSite === null) return null
  if (!onSite) return t('booking.remote')
  return address ? t('booking.onSiteAt', { address: [address.street, [address.postcode, address.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') }) : t('booking.onSiteShort')
}
