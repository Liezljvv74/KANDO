import { NoShowObjectionSchema, parseBody } from '@kando/contract'
import { objectNoShow } from '@kando/domain'
import { appRequest } from '../../../../../../../lib/app-request'

/** The reported side objects to a no-show report within 48 hours (body NoShowObjectionSchema). Allowed while suspended: a person must be able to answer a report. */
export const POST = appRequest({ auth: 'required', allowWhenSuspended: true, maxBodyBytes: 16_384 }, async ({ tx, user, request, params }) => {
  const input = await parseBody(NoShowObjectionSchema, request)
  return Response.json(await objectNoShow(tx, user!.id, params.id!, input))
})
