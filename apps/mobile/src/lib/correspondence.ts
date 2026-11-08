import type { Notification } from '@kando/contract'

import { isBookingNotice } from '@/lib/notification-text'

export type Category = 'bookings' | 'quotes' | 'messages'

const QUOTE_KINDS = ['quote-received', 'quote-expiring', 'quote-confirmed']

/** Which kind of job notice a notification is (counted by the Jobs tab); null for everything else (profile, payouts, invoices ..., the dot on My business). */
export function categoryOf(n: Pick<Notification, 'kind' | 'payload'>): Category | null {
  if (n.kind === 'message-received') return 'messages'
  if (QUOTE_KINDS.includes(n.kind)) return 'quotes'
  return isBookingNotice(n) ? 'bookings' : null
}
