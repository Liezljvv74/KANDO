import { parseBody, StopAnswerSchema } from '@kando/contract'
import { answerStop } from '@kando/domain'
import { appRequest } from '../../../../../../../lib/app-request'

/** The customer agrees to the stated amount or disagrees (body StopAnswerSchema). Allowed while suspended: it settles an existing job. */
export const POST = appRequest({ auth: 'required', allowWhenSuspended: true, maxBodyBytes: 1024 }, async ({ tx, user, request, params }) => {
  const input = await parseBody(StopAnswerSchema, request)
  return Response.json(await answerStop(tx, user!.id, params.id!, input))
})
