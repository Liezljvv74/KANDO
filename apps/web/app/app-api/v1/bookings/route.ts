import { ListQuerySchema, parseQuery } from '@kando/contract'
import { listBookings } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

// No POST: a new job is a request, then a quote, then a confirmation (MVP plan step 1.6). Old direct proposals are only listed and answered.
export const GET = appRequest({ auth: 'required' }, async ({ tx, user, request }) => {
  const { role, cursor } = parseQuery(ListQuerySchema, request)
  return Response.json(await listBookings(tx, user!.id, role, cursor))
})
