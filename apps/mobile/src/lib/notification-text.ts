import type { Notification } from '@kando/contract'

import { t, type Key } from '@/i18n'

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

/** The screen a notice opens: the provider's page for "now available" (the slug is in the payload link), the profile page (payout card) for "customers waiting"; null for the rest. */
export const notificationTarget = (n: Pick<Notification, 'kind' | 'payload'>): { path: string } | null => {
  if (n.kind === 'customers-waiting') return { path: '/my-profile' }
  if (n.kind !== 'provider-available' || !('url' in n.payload)) return null
  const slug = /^https?:\/\/[^/]+\/providers\/([^/?#]+)/.exec(n.payload.url)?.[1]
  return slug ? { path: `/provider/${slug}` } : null
}
