import { DisputeInputSchema, parseBody } from '@kando/contract'
import { getDispute, openDispute } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

/** The booking's dispute, for its two parties (the provider reads the customer's description here). */
export const GET = appRequest({ auth: 'required', allowWhenSuspended: true }, async ({ tx, user, params }) => Response.json(await getDispute(tx, user!.id, params.id!)))

/**
 * Either side reports a problem after Finished or Stop; the customer also once asked "Was the job done?" (openDispute).
 * Body DisputeInputSchema. Allowed while suspended: it is about money already paid.
 */
export const POST = appRequest({ auth: 'required', allowWhenSuspended: true, maxBodyBytes: 16_384 }, async ({ tx, user, request, params }) => {
  const input = await parseBody(DisputeInputSchema, request)
  return Response.json(await openDispute(tx, user!.id, params.id!, input))
})
