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
}

/** The message text of a notification, or null for a kind this app version does not know (a newer server): such a message is skipped, never a crash. */
export const notificationText = (kind: string): string | null => (kind in KEY ? t(KEY[kind as Notification['kind']]) : null)

export const MAX_BANNERS = 3

/** The open (not dismissed) messages, newest first: the first `max` to show and how many more are waiting. */
export function splitBanners(list: Notification[], max = MAX_BANNERS): { shown: Notification[]; more: number } {
  const open = list.filter((n) => !n.dismissedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return { shown: open.slice(0, max), more: Math.max(0, open.length - max) }
}

/** The profile link of a "profile is live" message; booking kinds carry ids only. */
export const notificationUrl = (n: Pick<Notification, 'payload'>): string | null => ('url' in n.payload && typeof n.payload.url === 'string' ? n.payload.url : null)
