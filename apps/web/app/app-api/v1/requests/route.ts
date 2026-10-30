import { ListQuerySchema, parseBody, parseQuery, RequestInputSchema } from '@kando/contract'
import { createRequest, listRequests } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user, request }) => {
  const { role, cursor } = parseQuery(ListQuerySchema, request)
  return Response.json(await listRequests(tx, user!.id, role, cursor))
})

export const POST = appRequest({ auth: 'required', maxBodyBytes: 16_384 }, async ({ tx, user, request, afterCommit }) => {
  const input = await parseBody(RequestInputSchema, request)
  return Response.json(await createRequest(tx, user!.id, input, new Date(), afterCommit), { status: 201 })
})
