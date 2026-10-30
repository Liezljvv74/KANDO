import { getThread } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user, params }) => Response.json(await getThread(tx, user!.id, params.id!)))
