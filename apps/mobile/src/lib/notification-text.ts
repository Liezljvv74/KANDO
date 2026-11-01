import { REQUEST_SCREEN_KINDS, type Notification } from '@kando/contract'

import { t, type Key } from '@/i18n'

// The in-app payload carries ids only (and the customers-waiting count), so the ending texts name their periods
// (7 days, 48 hours, 12 months, 30 days) in the catalogue; change them there together with the domain rules.
const KEY: Record<Notification['kind'], Key> = {
  'profile-live': 'notification.profileLive',
  'request-received': 'notification.requestReceived',
  'quote-received': 'notification.quoteReceived',
  'booking-proposed': 'notification.bookingProposed',
  'booking-accepted': 'notification.bookingAccepted',
  'booking-declined': 'notification.bookingDeclined',
  'booking-expired': 'notification.bookingExpired',
  'payment-reminder': 'notification.paymentReminder',
  'quote-expiring': 'notification.quoteExpiring',
  'request-expired': 'notification.requestExpired',
  'requests-ignored': 'notification.requestsIgnored',
  'pending-slot-requested': 'notification.pendingSlotRequested',
  'message-received': 'notification.messageReceived',
  'booking-paid': 'notification.bookingPaid',
  'payment-received': 'notification.paymentReceived',
  'payment-late-refunded': 'notification.paymentLateRefunded',
  'payout-setup-complete': 'notification.payoutSetupComplete',
  'customers-waiting': 'notification.customersWaiting',
  'provider-available': 'notification.providerAvailable',
  'refund-issued': 'notification.refundIssued',
  'job-finished': 'notification.jobFinished',
  'confirm-reminder': 'notification.confirmReminder',
  'payment-released': 'notification.paymentReleased',
  'was-job-done': 'notification.wasJobDone',
  'booking-cancelled': 'notification.bookingCancelled',
  'no-show-reported': 'notification.noShowReported',
  'dispute-opened': 'notification.disputeOpened',
  'dispute-decided': 'notification.disputeDecided',
  'job-stopped': 'notification.jobStopped',
  'stop-amount-stated': 'notification.stopAmountStated',
  'additional-task-requested': 'notification.additionalTaskRequested',
  'review-requested': 'notification.reviewRequested',
  'review-visible': 'notification.reviewVisible',
  'provider-warning': 'notification.providerWarning',
  'invoice-ready': 'notification.invoiceReady',
  'commission-invoice-ready': 'notification.commissionInvoiceReady',
  'request-withdrawn': 'notification.requestWithdrawn',
  'request-declined': 'notification.requestDeclined',
  'request-reopened': 'notification.requestReopened',
  'request-updated': 'notification.requestUpdated',
  'time-proposed': 'notification.timeProposed',
  'time-to-confirm': 'notification.timeToConfirm',
}

/** The message text of a notification, or null for a kind this app version does not know (a newer server): such a message is skipped, never a crash. */
export function notificationText(kind: string, payload: object = {}): string | null {
  const count = 'count' in payload && typeof payload.count === 'number' ? payload.count : 0 // customers-waiting: how many, never who
  if (kind === 'customers-waiting' && count > 0) return count === 1 ? t('notification.customersWaitingOne') : t('notification.customersWaitingMany', { count })
  return kind in KEY ? t(KEY[kind as Notification['kind']]) : null
}

export const MAX_BANNERS = 3

/** The open (not dismissed) messages, newest first: the first `max` to show and how many more are waiting. */
export function splitBanners(list: Notification[], max = MAX_BANNERS): { shown: Notification[]; more: number } {
  const open = list.filter((n) => !n.dismissedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return { shown: open.slice(0, max), more: Math.max(0, open.length - max) }
}

/** The profile link of a "profile is live" message to share; other kinds (booking ids, a chat link) have none. */
export const notificationUrl = (n: Pick<Notification, 'kind' | 'payload'>): string | null => (n.kind === 'profile-live' && 'url' in n.payload && typeof n.payload.url === 'string' ? n.payload.url : null)

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

/** The screen a notice opens: the provider's page for "now available" (the slug is in the payload link), the profile page (payout card) for "customers waiting", the commission invoice list for a new commission invoice, else the booking, or the request (first for request-withdrawn, -declined and -reopened: their booking has ended), or the list; null for the rest or a malformed id. */
export const notificationTarget = (n: Pick<Notification, 'kind' | 'payload'>): { path: string } | null => {
  if (n.kind === 'customers-waiting') return { path: '/my-profile' }
  if (n.kind === 'commission-invoice-ready') return { path: '/invoices/commission' }
  if (n.kind === 'profile-live' || n.kind === 'message-received') return null
  if (n.kind === 'provider-available') {
    const slug = 'url' in n.payload ? /^https?:\/\/[^/]+\/providers\/([^/?#]+)/.exec(n.payload.url)?.[1] : undefined
    return slug ? { path: `/provider/${slug}` } : null
  }
  const bookingId = idOf(n.payload, 'bookingId')
  const requestId = idOf(n.payload, 'requestId')
  const [first, second] = REQUEST_SCREEN_KINDS.includes(n.kind) ? [['request', requestId], ['booking', bookingId]] as const : [['booking', bookingId], ['request', requestId]] as const
  for (const [what, id] of [first, second]) {
    if (id === null) continue
    if (!ID.test(id)) return null
    return { path: what === 'booking' ? `/bookings/${id}` : `/bookings/request/${id}` }
  }
  return n.kind === 'requests-ignored' || n.kind === 'provider-warning' ? { path: '/bookings' } : null
}

/** A notice about a booking or request (shown on My bookings): it has an id to open, or is one of the list-level kinds. */
export const isBookingNotice = (n: Pick<Notification, 'kind' | 'payload'>): boolean => n.kind !== 'provider-available' && n.kind !== 'customers-waiting' && n.kind !== 'commission-invoice-ready' && notificationTarget(n) !== null
