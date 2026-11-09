import { FeedbackInputSchema, parseBody } from '@kando/contract'
import { db } from '@kando/db'
import { FeedbackLimited, FeedbackSendFailed, ipHashOf, sendFeedback } from '@kando/domain'
import { appRequest } from '@/lib/app-request'

// Signed out is allowed. The mail goes to one fixed address; the message is only emailed, never stored or logged.
// The counter and the mail run after the request transaction, on the owner connection. A suspended person or one with stale terms can still write to us.
export const POST = appRequest({ auth: 'optional', maxBodyBytes: 8 * 1024, allowWhenSuspended: true, allowStaleTerms: true }, async ({ user, request }) => {
  const input = await parseBody(FeedbackInputSchema, request)
  const ipHash = ipHashOf(request.headers)
  return async () => {
    try {
      await sendFeedback(db, input, user, ipHash)
      return Response.json({ ok: true })
    } catch (e) {
      if (e instanceof FeedbackLimited) return Response.json({ error: 'RATE_LIMITED', message: 'Too many messages. Please try again later.' }, { status: 429 })
      if (e instanceof FeedbackSendFailed) return Response.json({ error: 'SEND_FAILED', message: 'The message could not be sent. Please try again.' }, { status: 502 })
      throw e
    }
  }
})
