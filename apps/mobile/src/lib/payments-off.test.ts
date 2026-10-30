jest.mock('expo-secure-store', () => ({}))
jest.mock('expo-file-system', () => ({ File: class {} }))
import { ApiError } from '@/api/client'
import { noteIfOff, paymentsOff, paymentsProblem, resetPaymentsOff } from './payments-off'

jest.mock('@/i18n', () => ({ errorText: (c: string) => `text:${c}` }))

beforeEach(resetPaymentsOff)

test('PAYMENTS_OFF is remembered for the session; other errors are not', () => {
  expect(paymentsProblem(new ApiError(409, 'PROVIDER_NOT_READY'))).toBe('text:PROVIDER_NOT_READY')
  expect(paymentsOff()).toBe(false)
  expect(paymentsProblem(new ApiError(503, 'PAYMENTS_OFF'))).toBe('text:PAYMENTS_OFF')
  expect(paymentsOff()).toBe(true)
})

test('a failed status call with PAYMENTS_OFF is remembered (the card hides); other codes keep the retry', () => {
  expect(noteIfOff('network')).toBe(false)
  expect(noteIfOff(null)).toBe(false)
  expect(noteIfOff('PAYMENTS_OFF')).toBe(true)
  expect(paymentsOff()).toBe(true)
  expect(noteIfOff(undefined)).toBe(true) // stays off for the session
})
