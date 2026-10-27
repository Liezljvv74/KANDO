import { publish } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'

export const POST = appRequest({ auth: 'required' }, async ({ tx, user }) => Response.json(await publish(tx, user!.id)))
