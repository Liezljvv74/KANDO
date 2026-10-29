import { notificationText, notificationThreadId, notificationUrl, splitBanners } from './notification-text'

jest.mock('@/i18n', () => ({ t: (k: string) => k }))

test('every known kind has a text and an unknown kind is skipped without throwing', () => {
  expect(notificationText('requests-ignored')).toBe('notification.requestsIgnored')
  expect(notificationText('profile-live')).toBe('notification.profileLive')
  expect(notificationText('kind-from-a-newer-server')).toBeNull()
  for (const [kind, key] of [['booking-paid', 'notification.bookingPaid'], ['payment-received', 'notification.paymentReceived'], ['payment-late-refunded', 'notification.paymentLateRefunded'], ['payout-setup-complete', 'notification.payoutSetupComplete'], ['customers-waiting', 'notification.customersWaiting'], ['provider-available', 'notification.providerAvailable'], ['refund-issued', 'notification.refundIssued']]) {
    expect(notificationText(kind!)).toBe(key)
  }
})

test('only the profile-live payload has a shareable url', () => {
  expect(notificationUrl({ kind: 'profile-live', payload: { url: 'https://x.test/p' } })).toBe('https://x.test/p')
  expect(notificationUrl({ kind: 'message-received', payload: { url: 'skilled://threads/t1' } })).toBeNull()
  expect(notificationUrl({ kind: 'quote-received', payload: { bookingId: 'b' } })).toBeNull()
  expect(notificationUrl({ kind: 'quote-received', payload: {} })).toBeNull()
})

test('splitBanners: newest first, dismissed left out, capped with a count of the rest', () => {
  const n = (id: string, createdAt: string, dismissedAt: string | null = null) => ({ id, kind: 'quote-received' as const, payload: {}, createdAt, seenAt: null, dismissedAt })
  const list = [n('a', '2026-01-01'), n('b', '2026-01-02'), n('c', '2026-01-03'), n('d', '2026-01-04'), n('x', '2026-01-05', '2026-01-06')]
  expect(splitBanners(list)).toEqual({ shown: [list[3], list[2], list[1]], more: 1 })
  expect(splitBanners(list.slice(0, 2))).toEqual({ shown: [list[1], list[0]], more: 0 })
})

test('only a message-received notice opens a thread: by its threadId, else by the link', () => {
  expect(notificationThreadId({ kind: 'message-received', payload: { url: 'skilled://threads/x', threadId: 't1' } })).toBe('t1')
  expect(notificationThreadId({ kind: 'message-received', payload: { url: 'skilled://threads/t2' } })).toBe('t2')
  expect(notificationThreadId({ kind: 'message-received', payload: { url: 'https://evil.test/threads/t3' } })).toBeNull()
  expect(notificationThreadId({ kind: 'profile-live', payload: { url: 'skilled://threads/t1', threadId: 't1' } })).toBeNull()
  expect(notificationThreadId({ kind: 'quote-received', payload: { bookingId: 'b' } })).toBeNull()
})
