const mockStatus = jest.fn()
const mockSetup = jest.fn()
const mockSave = jest.fn()
const mockLists = jest.fn()
const mockLoadMe = jest.fn()
const mockNote = jest.fn()
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({})) }))
jest.mock('@/api/payments', () => ({ payoutStatus: (...a: unknown[]) => mockStatus(...a), startPayoutSetup: (...a: unknown[]) => mockSetup(...a) }))
jest.mock('@/api/my-profile', () => {
  const list = (...a: unknown[]) => mockLists(...a)
  return { saveMyProfile: (...a: unknown[]) => mockSave(...a), getMyProfile: list, servicesApi: { list }, referencesApi: { list }, photosApi: { list }, documentsApi: { list } }
})
jest.mock('@/hooks/use-me', () => ({ loadMe: (...a: unknown[]) => mockLoadMe(...a), noteQuoteSteps: (...a: unknown[]) => mockNote(...a) }))
jest.mock('@/lib/go', () => ({ go: jest.fn() }))

import { doQuoteStep, payoutOpened } from './do-quote-step'

beforeEach(() => {
  for (const m of [mockStatus, mockSetup, mockSave, mockLists, mockLoadMe, mockNote]) m.mockReset()
  mockSetup.mockResolvedValue({ url: 'https://connect.stripe.test/x' })
  mockLoadMe.mockResolvedValue({})
})

test('returning from Stripe reloads the checklist once (status once, /me once) when the payout is ready', async () => {
  mockStatus.mockResolvedValue({ ready: true })
  await doQuoteStep('payout')
  expect(payoutOpened()).toBe(true)
  expect(mockStatus).toHaveBeenCalledTimes(1)
  expect(mockLoadMe).toHaveBeenCalledTimes(1)
  expect(mockLists).not.toHaveBeenCalled()
})

test('returning from Stripe unfinished, or with a failed status call, reloads nothing', async () => {
  mockStatus.mockResolvedValue({ ready: false })
  await doQuoteStep('payout')
  mockStatus.mockRejectedValue(new Error('x'))
  await doQuoteStep('payout')
  expect(mockLoadMe).not.toHaveBeenCalled()
})

test('a consent save makes no list requests: the saved profile carries the fresh steps into /me', async () => {
  mockSave.mockResolvedValue({ quoteSteps: ['payout'] })
  expect(await doQuoteStep('consent')).toEqual({ quoteSteps: ['payout'] })
  expect(mockSave).toHaveBeenCalledWith({ invoiceConsent: true })
  expect(mockNote).toHaveBeenCalledWith(['payout'])
  expect(mockLists).not.toHaveBeenCalled()
  expect(mockLoadMe).not.toHaveBeenCalled()
  expect(mockStatus).not.toHaveBeenCalled()
})

test('a link that is not https is never opened', async () => {
  mockSetup.mockResolvedValue({ url: 'http://evil.test' })
  await expect(doQuoteStep('payout')).rejects.toThrow('bad link')
  expect(mockStatus).not.toHaveBeenCalled()
})
