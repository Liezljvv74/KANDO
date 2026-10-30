import { FinishInputSchema, parseBody } from '@kando/contract'
import { finishJob } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

/** The provider's "Finished" (body FinishInputSchema). Not while suspended: the customer is then asked "Was the job done?" after the end. */
export const POST = appRequest({ auth: 'required', maxBodyBytes: 1_024 }, async ({ tx, user, request, params }) => {
  const input = await parseBody(FinishInputSchema, request)
  return Response.json(await finishJob(tx, user!.id, params.id!, input))
})
