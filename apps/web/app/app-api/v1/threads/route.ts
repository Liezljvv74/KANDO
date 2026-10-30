import { ListQuerySchema, parseQuery } from '@kando/contract'
import { listThreads } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user, request }) =>
  Response.json(await listThreads(tx, user!.id, parseQuery(ListQuerySchema.pick({ cursor: true }), request).cursor)),
)
