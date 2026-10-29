import { notificationText, notificationUrl, splitBanners } from './notification-text'

jest.mock('@/i18n', () => ({ t: (k: string) => k }))

test('every known kind has a text and an unknown kind is skipped without throwing', () => {
  expect(notificationText('requests-ignored')).toBe('notification.requestsIgnored')
  expect(notificationText('profile-live')).toBe('notification.profileLive')
  expect(notificationText('kind-from-a-newer-server')).toBeNull()
})

test('only the profile-live payload has a url', () => {
  expect(notificationUrl({ payload: { url: 'https://x.test/p' } })).toBe('https://x.test/p')
  expect(notificationUrl({ payload: { bookingId: 'b' } })).toBeNull()
  expect(notificationUrl({ payload: {} })).toBeNull()
})

test('splitBanners: newest first, dismissed left out, capped with a count of the rest', () => {
  const n = (id: string, createdAt: string, dismissedAt: string | null = null) => ({ id, kind: 'quote-received' as const, payload: {}, createdAt, seenAt: null, dismissedAt })
  const list = [n('a', '2026-01-01'), n('b', '2026-01-02'), n('c', '2026-01-03'), n('d', '2026-01-04'), n('x', '2026-01-05', '2026-01-06')]
  expect(splitBanners(list)).toEqual({ shown: [list[3], list[2], list[1]], more: 1 })
  expect(splitBanners(list.slice(0, 2))).toEqual({ shown: [list[1], list[0]], more: 0 })
})
