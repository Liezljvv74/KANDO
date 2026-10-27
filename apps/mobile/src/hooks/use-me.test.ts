import { getMe } from '@/api/client'
import { clearMe, currentMe, loadMe } from './use-me'

jest.mock('@/api/client', () => ({ getMe: jest.fn() }))
jest.mock('@/api/my-profile', () => ({ notificationsApi: { mark: jest.fn() } }))

test('a loadMe in flight at sign-out never fills the store for the next account', async () => {
  let resolve!: (m: unknown) => void
  jest.mocked(getMe).mockReturnValue(new Promise((r) => (resolve = r)) as never)
  const loading = loadMe()
  clearMe()
  resolve({ id: 'a', notifications: [{ id: 'n1' }] })
  await loading
  expect(currentMe()).toBeNull()
})
