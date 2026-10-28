import { unpublish } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'

export const POST = appRequest({ auth: 'required', allowWhenSuspended: true }, async ({ tx, user }) => Response.json(await unpublish(tx, user!.id)))
