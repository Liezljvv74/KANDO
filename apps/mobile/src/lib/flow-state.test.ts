const mockLoadMe = jest.fn()
const mockProfile = jest.fn()
const mockList = jest.fn()
const mockDocs = jest.fn()
const mockCats = jest.fn()
const mockOpenPayout = jest.fn()
const mockReplace = jest.fn()
jest.mock('@/hooks/use-me', () => ({ loadMe: (...a: unknown[]) => mockLoadMe(...a) }))
jest.mock('@/api/my-profile', () => ({ getMyProfile: (...a: unknown[]) => mockProfile(...a), servicesApi: { list: (...a: unknown[]) => mockList(...a) }, documentsApi: { list: (...a: unknown[]) => mockDocs(...a) } }))
jest.mock('@/api/providers', () => ({ getCategories: (...a: unknown[]) => mockCats(...a) }))
jest.mock('@/lib/do-quote-step', () => ({ openPayoutSetup: (...a: unknown[]) => mockOpenPayout(...a) }))
jest.mock('@/lib/go', () => ({ goReplace: (...a: unknown[]) => mockReplace(...a) }))

import { goToStep, loadNextStep } from './flow-state'

const fullMe = { isProvider: true, firstName: 'A', lastName: 'B', birthDate: '1990-01-01', address: { postcode: '10115' } }
beforeEach(() => {
  for (const m of [mockLoadMe, mockProfile, mockList, mockDocs, mockCats, mockOpenPayout, mockReplace]) m.mockReset()
  mockLoadMe.mockResolvedValue(fullMe)
  mockList.mockResolvedValue([])
  mockDocs.mockResolvedValue([])
  mockCats.mockResolvedValue([])
})

test('a provider with a service missing goes to the service first', async () => {
  mockProfile.mockResolvedValue({ missing: ['service'], quoteSteps: ['payout'] })
  expect(await loadNextStep()).toEqual({ kind: 'service', path: '/my-profile/service/new' })
})
test('everything done: null', async () => {
  mockProfile.mockResolvedValue({ missing: [], quoteSteps: [] })
  expect(await loadNextStep()).toBeNull()
})
test('a customer with a complete account: null, no provider calls', async () => {
  mockLoadMe.mockResolvedValue({ ...fullMe, isProvider: false, birthDate: null })
  expect(await loadNextStep()).toBeNull()
  expect(mockProfile).not.toHaveBeenCalled()
  expect(mockList).not.toHaveBeenCalled()
  expect(mockDocs).not.toHaveBeenCalled()
})
test('payout step: ready goes on to the next open step, not ready goes to My profile', async () => {
  mockOpenPayout.mockResolvedValue({ ready: true })
  mockProfile.mockResolvedValue({ missing: [], quoteSteps: [] })
  await goToStep({ kind: 'payout' })
  expect(mockReplace).not.toHaveBeenCalled()
  mockOpenPayout.mockResolvedValue({ ready: false })
  await goToStep({ kind: 'payout' })
  expect(mockReplace).toHaveBeenCalledWith('/my-profile')
})
