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

/**
 * A quote or booking notice that the job page of request `requestId` (with its bookings `bookingIds`) shows: the page it opens
 * (`job.requestId`), or the request or a booking it names. Opening that page marks them seen (else they never are, and the daily
 * clean-up keeps an unseen notice). Chat notices are not: the chat marks its own.
 */
export function isJobPageNotice(n: Pick<Notification, 'kind' | 'payload' | 'job'>, requestId: string, bookingIds: readonly string[]): boolean {
  const c = categoryOf(n)
  if (c !== 'quotes' && c !== 'bookings') return false
  const p = n.payload as { requestId?: string; bookingId?: string }
  return n.job?.requestId === requestId || p.requestId === requestId || (!!p.bookingId && bookingIds.includes(p.bookingId))
}
