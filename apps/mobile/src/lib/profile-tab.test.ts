import { currentMe, clearMe, loadMe } from '@/hooks/use-me'
import { showProfileTab } from './profile-tab'

jest.mock('@/api/client', () => ({ getMe: jest.fn(async () => ({ isProvider: true, notifications: [] })) }))
jest.mock('@/api/my-profile', () => ({ notificationsApi: {} }))

test('the My profile tab shows only for a known provider', () => {
  expect(showProfileTab(null)).toBe(false)
  expect(showProfileTab({ isProvider: false })).toBe(false)
  expect(showProfileTab({ isProvider: true })).toBe(true)
})

test('after sign-out the next account does not inherit the provider tab', async () => {
  await loadMe()
  expect(showProfileTab(currentMe())).toBe(true)
  clearMe()
  expect(showProfileTab(currentMe())).toBe(false)
})
