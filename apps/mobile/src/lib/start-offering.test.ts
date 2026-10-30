import { ApiError } from '@/api/client'
import { ensureDraft } from '@/api/my-profile'
import { clearMe, loadMe } from '@/hooks/use-me'
import { consumePending, clearPending } from './pending-navigation'
import { startOffering } from './start-offering'

const mockCalls: string[] = []
jest.mock('@/api/client', () => ({ ApiError: class ApiError extends Error { status: number; code: string; constructor(status: number, code: string) { super(code); this.status = status; this.code = code } } }))
jest.mock('@/api/my-profile', () => ({ ensureDraft: jest.fn(async () => void mockCalls.push('ensureDraft')) }))
jest.mock('@/hooks/use-me', () => {
  let gen = 0
  return {
    loadMe: jest.fn(async () => (mockCalls.push('loadMe'), { isProvider: true })),
    clearMe: () => void gen++,
    signOutGeneration: () => gen,
  }
})
jest.mock('@/i18n', () => ({ errorText: (c: string) => `error:${c}` }))

beforeEach(() => {
  mockCalls.length = 0
  jest.clearAllMocks()
  clearPending()
})

test('creates the draft, reloads /me, then sets the target, in that order', async () => {
  expect(await startOffering()).toBeNull()
  expect(mockCalls).toEqual(['ensureDraft', 'loadMe'])
  expect(consumePending()).toEqual({ path: '/my-profile', welcome: false })
})

test('welcome passes through', async () => {
  await startOffering(true)
  expect(consumePending()).toEqual({ path: '/my-profile', welcome: true })
})

test('a failure returns the error text and does not navigate', async () => {
  ;(ensureDraft as jest.Mock).mockRejectedValueOnce(new ApiError(500, 'network'))
  expect(await startOffering()).toBe('error:network')
  expect(consumePending()).toBeNull()
  ;(loadMe as jest.Mock).mockRejectedValueOnce(new Error('x'))
  expect(await startOffering()).toBe('error:')
  expect(consumePending()).toBeNull()
})

test('a draft that does not make a provider gives the offer-not-saved text', async () => {
  ;(loadMe as jest.Mock).mockResolvedValueOnce({ isProvider: false })
  expect(await startOffering()).toBe('error:OFFER_NOT_SAVED')
})

test('a network failure gives the network text', async () => {
  ;(ensureDraft as jest.Mock).mockRejectedValueOnce(new ApiError(0, 'network'))
  expect(await startOffering()).toBe('error:network')
})

test('AUTH_BUSY gives the busy text', async () => {
  ;(loadMe as jest.Mock).mockRejectedValueOnce(new ApiError(503, 'AUTH_BUSY'))
  expect(await startOffering()).toBe('error:AUTH_BUSY')
})

test('a second call while one runs does nothing extra', async () => {
  const [a, b] = await Promise.all([startOffering(), startOffering()])
  expect([a, b]).toEqual([null, null])
  expect(ensureDraft).toHaveBeenCalledTimes(1)
  expect(consumePending()).not.toBeNull()
  await startOffering() // finished: a new tap works again
  expect(ensureDraft).toHaveBeenCalledTimes(2)
})

test('no target when /me says the person is not a provider', async () => {
  ;(loadMe as jest.Mock).mockResolvedValueOnce({ isProvider: false })
  expect(await startOffering()).toBe('error:OFFER_NOT_SAVED')
  expect(consumePending()).toBeNull()
})

test('a sign-out during the run leaves no target behind', async () => {
  ;(loadMe as jest.Mock).mockImplementationOnce(async () => (clearMe(), { isProvider: true }))
  await startOffering()
  expect(consumePending()).toBeNull()
})
