import { AdditionalTaskInputSchema, parseBody } from '@kando/contract'
import { startAdditionalTask } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

/** Either side asks for extra work on a paid booking (body AdditionalTaskInputSchema); the provider then quotes it. */
export const POST = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request, params }) => {
  const input = await parseBody(AdditionalTaskInputSchema, request)
  return Response.json(await startAdditionalTask(tx, user!.id, params.id!, input), { status: 201 })
})
