import { REQUEST_SCREEN_KINDS, type NoticeJob, type Notification } from '@kando/contract'

/** The thread a "new message" notice opens: the payload's threadId, else the id in its own `skilled://threads/<id>` link; null for any other kind or link. */
export const notificationThreadId = (n: Pick<Notification, 'kind' | 'payload'>): string | null => {
  if (n.kind !== 'message-received' || !('url' in n.payload)) return null
  return n.payload.threadId ?? /^skilled:\/\/threads\/([^/?#]+)$/.exec(n.payload.url)?.[1] ?? null
}

const ID = /^[\w-]{1,100}$/ // the rule pushRoute uses
const idOf = (payload: object, key: 'bookingId' | 'requestId'): string | null => {
  const v = (payload as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : null
}

/**
 * The screen a notice opens: the provider's page for "now available" (the slug is in the payload link), the profile page (payout card) for "customers waiting", the commission invoice list for a new commission invoice;
 * a notice of a job opens its job page (`job.requestId`: the request page that shows it, scrolled to the booking it names); without that (an older server) the booking, or the request (first for
 * request-withdrawn, -declined and -reopened: their booking has ended), which lands on the same job page; else the list; null for the rest or a malformed id. A provider warning keeps the booking link.
 */
export const notificationTarget = (n: Pick<Notification, 'kind' | 'payload'> & { job?: Pick<NoticeJob, 'id' | 'requestId'> | null }): { path: string } | null => {
  if (n.kind === 'customers-waiting' || n.kind === 'payout-setup-complete') return { path: '/my-profile' }
  if (n.kind === 'commission-invoice-ready') return { path: '/invoices/commission' }
  if (n.kind === 'profile-live' || n.kind === 'message-received') return null
  if (n.kind === 'provider-available') {
    const slug = 'url' in n.payload ? /^https?:\/\/[^/]+\/providers\/([^/?#]+)/.exec(n.payload.url)?.[1] : undefined
    return slug ? { path: `/provider/${slug}` } : null
  }
  const bookingId = idOf(n.payload, 'bookingId')
  const requestId = idOf(n.payload, 'requestId')
  const page = n.job?.requestId
  if (page && ID.test(page) && n.kind !== 'provider-warning' && (bookingId === null || ID.test(bookingId))) return { path: `/bookings/request/${page}${bookingId ? `?booking=${bookingId}` : ''}` }
  const [first, second] = REQUEST_SCREEN_KINDS.includes(n.kind) ? [['request', requestId], ['booking', bookingId]] as const : [['booking', bookingId], ['request', requestId]] as const
  for (const [what, id] of [first, second]) {
    if (id === null) continue
    if (!ID.test(id)) return null
    return { path: what === 'booking' ? `/bookings/${id}` : `/bookings/request/${id}` }
  }
  return n.kind === 'requests-ignored' || n.kind === 'provider-warning' ? { path: '/bookings' } : null
}

/** A notice about a booking or request (shown on My bookings): it has an id to open, or is one of the list-level kinds. */
export const isBookingNotice = (n: Pick<Notification, 'kind' | 'payload'>): boolean => n.kind !== 'provider-available' && n.kind !== 'customers-waiting' && n.kind !== 'payout-setup-complete' && n.kind !== 'commission-invoice-ready' && notificationTarget(n) !== null
