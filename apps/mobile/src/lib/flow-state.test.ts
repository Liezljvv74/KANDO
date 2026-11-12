const mockLoadMe = jest.fn()
const mockProfile = jest.fn()
const mockList = jest.fn()
const mockDocs = jest.fn()
const mockCats = jest.fn()
const mockOpenPayout = jest.fn()
const mockReplace = jest.fn()
const mockHeldMe = jest.fn(() => ({ quoteSteps: [] as string[] }))
jest.mock('@/hooks/use-me', () => ({ loadMe: (...a: unknown[]) => mockLoadMe(...a), currentMe: () => mockHeldMe() }))
jest.mock('@/api/my-profile', () => ({ getMyProfile: (...a: unknown[]) => mockProfile(...a), servicesApi: { list: (...a: unknown[]) => mockList(...a) }, documentsApi: { list: (...a: unknown[]) => mockDocs(...a) } }))
jest.mock('@/api/providers', () => ({ getCategories: (...a: unknown[]) => mockCats(...a) }))
const mockSent = jest.fn(() => false)
jest.mock('@/lib/do-quote-step', () => ({ openPayoutSetup: (...a: unknown[]) => mockOpenPayout(...a), payoutOpened: () => mockSent() }))
const mockFinish = jest.fn()
jest.mock('@/lib/finish-flow', () => ({ finishFlow: (...a: unknown[]) => mockFinish(...a) }))
jest.mock('@/lib/go', () => ({ goReplace: (...a: unknown[]) => mockReplace(...a) }))

import { continueAfterAutoStep, goToStep, loadNextStep } from './flow-state'

const fullMe = { isProvider: true, firstName: 'A', lastName: 'B', birthDate: '1990-01-01', address: { postcode: '10115' } }
beforeEach(() => {
  for (const m of [mockLoadMe, mockProfile, mockList, mockDocs, mockCats, mockOpenPayout, mockReplace, mockFinish]) m.mockReset()
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

test('ready payout and nothing else open: the flow ends for a provider', async () => {
  mockOpenPayout.mockResolvedValue({ ready: true })
  mockProfile.mockResolvedValue({ missing: [], quoteSteps: [] })
  await goToStep({ kind: 'payout' })
  expect(mockFinish).toHaveBeenCalledWith('provider', false)
})
test('ready payout and the reload fails: My profile, not the end', async () => {
  mockOpenPayout.mockResolvedValue({ ready: true })
  mockLoadMe.mockRejectedValue(new Error('x'))
  await goToStep({ kind: 'payout' })
  expect(mockReplace).toHaveBeenCalledWith('/my-profile')
  expect(mockFinish).not.toHaveBeenCalled()
})
test('ready payout but the server still lists payout: My profile, no loop', async () => {
  mockOpenPayout.mockResolvedValue({ ready: true })
  mockProfile.mockResolvedValue({ missing: [], quoteSteps: ['payout'] })
  await goToStep({ kind: 'payout' })
  expect(mockOpenPayout).toHaveBeenCalledTimes(1)
  expect(mockReplace).toHaveBeenCalledWith('/my-profile')
})

test('continueAfterAutoStep: a next step opens it, none ends the flow, a load error goes to My profile', async () => {
  mockProfile.mockResolvedValue({ missing: ['service'], quoteSteps: [] })
  await continueAfterAutoStep(() => true)
  expect(mockReplace).toHaveBeenCalledWith('/my-profile/service/new')
  mockReplace.mockReset()
  mockProfile.mockResolvedValue({ missing: [], quoteSteps: [] })
  await continueAfterAutoStep(() => true)
  expect(mockFinish).toHaveBeenCalledWith('provider', false)
  mockLoadMe.mockRejectedValue(new Error('x'))
  await continueAfterAutoStep(() => true)
  expect(mockReplace).toHaveBeenCalledWith('/my-profile')
})
test('continueAfterAutoStep never opens Stripe again', async () => {
  mockProfile.mockResolvedValue({ missing: [], quoteSteps: ['payout'] })
  await continueAfterAutoStep(() => true)
  expect(mockOpenPayout).not.toHaveBeenCalled()
  expect(mockReplace).toHaveBeenCalledWith('/my-profile')
})

test('continueAfterAutoStep: the screen was left while loading: no navigation, no finish', async () => {
  mockProfile.mockResolvedValue({ missing: ['service'], quoteSteps: [] })
  await continueAfterAutoStep(() => false)
  mockProfile.mockResolvedValue({ missing: [], quoteSteps: [] })
  await continueAfterAutoStep(() => false)
  mockLoadMe.mockRejectedValue(new Error('x'))
  await continueAfterAutoStep(() => false)
  expect(mockReplace).not.toHaveBeenCalled()
  expect(mockFinish).not.toHaveBeenCalled()
})

test('a payout form already sent (Stripe still checking) is not an open step', async () => {
  mockProfile.mockResolvedValue({ missing: [], quoteSteps: ['payout'] })
  expect(await loadNextStep()).toEqual({ kind: 'payout' })
  mockSent.mockReturnValue(true)
  expect(await loadNextStep()).toBeNull()
  mockSent.mockReturnValue(false)
})

test('the server says the payout form was started: not open, even in a fresh session', async () => {
  mockSent.mockReturnValue(false)
  mockProfile.mockResolvedValue({ missing: [], quoteSteps: ['payout'], payoutStarted: true })
  expect(await loadNextStep()).toBeNull()
  mockProfile.mockResolvedValue({ missing: [], quoteSteps: ['payout'], payoutStarted: false })
  expect(await loadNextStep()).toEqual({ kind: 'payout' })
})
test('an older server (no flag) falls back to the local marker', async () => {
  mockProfile.mockResolvedValue({ missing: [], quoteSteps: ['payout'] })
  expect(await loadNextStep()).toEqual({ kind: 'payout' })
  mockSent.mockReturnValue(true)
  expect(await loadNextStep()).toBeNull()
  mockSent.mockReturnValue(false)
})

test('the flow ends with the payout flag while /me still lists the payout as an open step', async () => {
  mockHeldMe.mockReturnValue({ quoteSteps: ['payout'] })
  mockProfile.mockResolvedValue({ missing: [], quoteSteps: [], payoutStarted: true })
  await continueAfterAutoStep(() => true)
  expect(mockFinish).toHaveBeenCalledWith('provider', true)
})
