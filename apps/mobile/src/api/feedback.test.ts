import { ApiError, api } from '@/api/client'
import { feedbackErrorKey, feedbackProblem, sendFeedback } from './feedback'

jest.mock('@/api/client', () => ({
  api: jest.fn(),
  ApiError: class extends Error {
    status: number
    code: string
    fields?: string[]
    constructor(status: number, code: string, _missing?: string[], fields?: string[]) {
      super(code)
      this.status = status
      this.code = code
      this.fields = fields
    }
  },
}))
jest.mock('@/i18n', () => ({ t: (k: string) => k }))

beforeEach(() => (api as jest.Mock).mockReset().mockResolvedValue({ ok: true }))

test('sendFeedback posts the email and message to the feedback route', async () => {
  await sendFeedback({ email: 'a@b.de', message: 'hi' })
  expect((api as jest.Mock).mock.calls.at(-1)).toEqual(['/app-api/v1/feedback', { method: 'POST', body: { email: 'a@b.de', message: 'hi' } }])
})

test('the form states: invalid email, empty and too long are found before sending', () => {
  expect(feedbackProblem('', 'hi')).toBe('feedback.error.email')
  expect(feedbackProblem('nope', 'hi')).toBe('feedback.error.email')
  expect(feedbackProblem('a@b.de', '   ')).toBe('feedback.error.empty')
  expect(feedbackProblem('a@b.de', 'x'.repeat(2001))).toBe('feedback.error.tooLong')
  expect(feedbackProblem(' a@b.de ', 'x'.repeat(2000))).toBeNull()
})

test('a failed send maps to rate limited, no connection, or could not be sent (retry)', () => {
  expect(feedbackErrorKey(new ApiError(429, 'RATE_LIMITED'))).toBe('feedback.error.limited')
  expect(feedbackErrorKey(new ApiError(0, 'network'))).toBe('error.network')
  expect(feedbackErrorKey(new ApiError(502, 'SEND_FAILED'))).toBe('feedback.error.failed')
  expect(feedbackErrorKey(new ApiError(400, 'Invalid input', undefined, ['email']))).toBe('feedback.error.email')
  expect(feedbackErrorKey(new ApiError(400, 'Invalid input', undefined, ['message']))).toBe('feedback.error.tooLong')
  expect(feedbackErrorKey(new Error('x'))).toBe('feedback.error.failed')
})
