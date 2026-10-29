import { notificationText, notificationUrl } from './notification-text'

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
