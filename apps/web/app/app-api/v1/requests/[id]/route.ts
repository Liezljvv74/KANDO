import { getRequest } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user, params }) =>
  Response.json(await getRequest(tx, user!.id, params.id!)),
)
