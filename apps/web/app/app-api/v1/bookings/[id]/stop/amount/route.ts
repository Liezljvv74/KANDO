import { parseBody, StopAmountInputSchema } from '@kando/contract'
import { stateStopAmount } from '@kando/domain'
import { appRequest } from '../../../../../../../lib/app-request'

/** The provider states the amount earned up to the stop (body StopAmountInputSchema). Allowed while suspended: it settles an existing job. */
export const POST = appRequest({ auth: 'required', allowWhenSuspended: true, maxBodyBytes: 4096 }, async ({ tx, user, request, params }) => {
  const input = await parseBody(StopAmountInputSchema, request)
  return Response.json(await stateStopAmount(tx, user!.id, params.id!, input))
})
