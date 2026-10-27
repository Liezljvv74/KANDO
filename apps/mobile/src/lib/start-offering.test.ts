import { router } from 'expo-router'

import { ApiError } from '@/api/client'
import { ensureDraft } from '@/api/my-profile'
import { loadMe } from '@/hooks/use-me'
import { startOffering } from './start-offering'

const mockCalls: string[] = []
jest.mock('expo-router', () => ({ router: { navigate: jest.fn((to: string) => mockCalls.push(`navigate ${to}`)) } }))
jest.mock('@/api/client', () => ({ ApiError: class ApiError extends Error { status: number; code: string; constructor(status: number, code: string) { super(code); this.status = status; this.code = code } } }))
jest.mock('@/api/my-profile', () => ({ ensureDraft: jest.fn(async () => void mockCalls.push('ensureDraft')) }))
jest.mock('@/hooks/use-me', () => ({ loadMe: jest.fn(async () => void mockCalls.push('loadMe')) }))
jest.mock('@/i18n', () => ({ errorText: (c: string) => `error:${c}` }))

beforeEach(() => {
  mockCalls.length = 0
  jest.clearAllMocks()
})

test('creates the draft, reloads /me, then opens the profile page, in that order', async () => {
  expect(await startOffering()).toBeNull()
  expect(mockCalls).toEqual(['ensureDraft', 'loadMe', 'navigate /my-profile'])
})

test('welcome passes through to the page', async () => {
  await startOffering(true)
  expect(router.navigate).toHaveBeenCalledWith('/my-profile?welcome=1')
})

test('a failure returns the error text and does not navigate', async () => {
  ;(ensureDraft as jest.Mock).mockRejectedValueOnce(new ApiError(500, 'network'))
  expect(await startOffering()).toBe('error:network')
  expect(router.navigate).not.toHaveBeenCalled()
  ;(loadMe as jest.Mock).mockRejectedValueOnce(new Error('x'))
  expect(await startOffering()).toBe('error:')
  expect(router.navigate).not.toHaveBeenCalled()
})

test('a second call while one runs does nothing extra', async () => {
  const [a, b] = await Promise.all([startOffering(), startOffering()])
  expect([a, b]).toEqual([null, null])
  expect(ensureDraft).toHaveBeenCalledTimes(1)
  expect(router.navigate).toHaveBeenCalledTimes(1)
  await startOffering() // finished: a new tap works again
  expect(ensureDraft).toHaveBeenCalledTimes(2)
})
