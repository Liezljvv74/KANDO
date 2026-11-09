import { FEEDBACK_MESSAGE_MAX, type FeedbackInput } from '@kando/contract'

import { ApiError, api } from '@/api/client'
import type { Key } from '@/i18n'

/** Emails the comment to the team (signed out works too). Nothing is stored on the server. */
export const sendFeedback = (input: FeedbackInput) => api<{ ok: true }>('/app-api/v1/feedback', { method: 'POST', body: input })

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** What is wrong with the form before it is sent (the server checks again), as a text key; null when it can be sent. */
export function feedbackProblem(email: string, message: string): Key | null {
  const e = email.trim()
  if (!e || e.length > 254 || !EMAIL.test(e)) return 'feedback.error.email'
  const m = message.trim()
  if (!m) return 'feedback.error.empty'
  if (m.length > FEEDBACK_MESSAGE_MAX) return 'feedback.error.tooLong'
  return null
}

/** The text key for a failed send: limited (429), no connection, or the general "could not be sent". */
export function feedbackErrorKey(e: unknown): Key {
  if (!(e instanceof ApiError)) return 'feedback.error.failed'
  if (e.status === 429) return 'feedback.error.limited'
  if (e.code === 'network') return 'error.network'
  if (e.status === 400) return e.fields?.includes('email') ? 'feedback.error.email' : e.fields?.includes('message') ? 'feedback.error.tooLong' : 'feedback.error.failed'
  return 'feedback.error.failed'
}
