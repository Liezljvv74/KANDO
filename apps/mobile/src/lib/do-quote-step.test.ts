const mockStatus = jest.fn()
const mockProfile = jest.fn()
jest.mock('expo-web-browser', () => ({}))
jest.mock('@/api/payments', () => ({ payoutStatus: (...a: unknown[]) => mockStatus(...a), startPayoutSetup: jest.fn() }))
jest.mock('@/api/my-profile', () => ({ getMyProfile: (...a: unknown[]) => mockProfile(...a), saveMyProfile: jest.fn() }))
jest.mock('@/lib/go', () => ({ go: jest.fn() }))

import { getProfileFresh } from './do-quote-step'

beforeEach(() => {
  mockStatus.mockReset()
  mockProfile.mockReset()
})

test('without an open payout step the profile is read once and Stripe is not asked', async () => {
  mockProfile.mockResolvedValue({ quoteSteps: ['consent'] })
  await getProfileFresh()
  expect(mockProfile).toHaveBeenCalledTimes(1)
  expect(mockStatus).not.toHaveBeenCalled()
})

test('with the payout step open, the profile is read again only when Stripe says ready', async () => {
  mockProfile.mockResolvedValue({ quoteSteps: ['payout'] })
  mockStatus.mockResolvedValue({ ready: false })
  await getProfileFresh()
  expect(mockProfile).toHaveBeenCalledTimes(1)
  mockProfile.mockClear()
  mockStatus.mockResolvedValue({ ready: true })
  await getProfileFresh()
  expect(mockProfile).toHaveBeenCalledTimes(2)
})

test('a failed status call keeps the first profile', async () => {
  mockProfile.mockResolvedValue({ quoteSteps: ['payout'] })
  mockStatus.mockRejectedValue(new Error('x'))
  expect(await getProfileFresh()).toEqual({ quoteSteps: ['payout'] })
})
