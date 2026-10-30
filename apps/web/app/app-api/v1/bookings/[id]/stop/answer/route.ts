import { parseBody, StopAnswerSchema } from '@kando/contract'
import { beginAnswerStop } from '@kando/domain'
import { appRequest } from '../../../../../../../lib/app-request'

/** The customer agrees to the stated amount or disagrees (body StopAnswerSchema); an agreed payment runs after the request transaction. Allowed while suspended: it settles an existing job. */
export const POST = appRequest({ auth: 'required', allowWhenSuspended: true, maxBodyBytes: 1024 }, async ({ tx, user, request, params }) => {
  const input = await parseBody(StopAnswerSchema, request)
  const settle = await beginAnswerStop(tx, user!.id, params.id!, input)
  return async () => Response.json(await settle())
})
