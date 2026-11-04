import type { Notification } from '@kando/contract'

import { isBookingNotice } from '@/lib/notification-text'

export type Category = 'bookings' | 'quotes' | 'messages'

const QUOTE_KINDS = ['quote-received', 'quote-expiring', 'quote-confirmed']

/** Which Correspondence list a notification belongs to; null for everything else (profile, payouts, invoices ...). */
export function categoryOf(n: Pick<Notification, 'kind' | 'payload'>): Category | null {
  if (n.kind === 'message-received') return 'messages'
  if (QUOTE_KINDS.includes(n.kind)) return 'quotes'
  return isBookingNotice(n) ? 'bookings' : null
}

/** How many notifications in each list the person has not seen (and not dismissed) yet. */
export function unseenCounts(notifications: Notification[] | undefined): Record<Category, number> & { total: number } {
  const c = { bookings: 0, quotes: 0, messages: 0, total: 0 }
  for (const n of notifications ?? []) {
    const cat = categoryOf(n)
    if (!cat || n.seenAt || n.dismissedAt) continue
    c[cat]++
    c.total++
  }
  return c
}
