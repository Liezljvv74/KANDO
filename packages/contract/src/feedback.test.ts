import { expect, it } from 'vitest'

import { FeedbackInputSchema, FEEDBACK_MESSAGE_MAX } from './feedback'

const ok = { email: 'a@b.de', message: 'Great app' }

it('accepts a valid email and message and trims both', () => {
  expect(FeedbackInputSchema.parse({ email: ' a@b.de ', message: '  hi  ' })).toEqual({ email: 'a@b.de', message: 'hi' })
})

it('refuses an invalid or too long email', () => {
  for (const email of ['', 'nope', 'a@', `${'a'.repeat(250)}@b.de`]) expect(FeedbackInputSchema.safeParse({ ...ok, email }).success, email).toBe(false)
})

it('refuses an empty, blank or too long message; 2000 characters are fine', () => {
  for (const message of ['', '   ', 'x'.repeat(FEEDBACK_MESSAGE_MAX + 1)]) expect(FeedbackInputSchema.safeParse({ ...ok, message }).success).toBe(false)
  expect(FeedbackInputSchema.safeParse({ ...ok, message: 'x'.repeat(FEEDBACK_MESSAGE_MAX) }).success).toBe(true)
})
