import { parseBody, RequestInputSchema } from '@kando/contract'
import { createRequest, listRequests } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user, request }) => {
  const role = new URL(request.url).searchParams.get('role') === 'provider' ? 'provider' : 'customer'
  return Response.json({ docs: await listRequests(tx, user!.id, role) })
})

export const POST = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request }) => {
  const input = await parseBody(RequestInputSchema, request)
  return Response.json(await createRequest(tx, user!.id, input), { status: 201 })
})
