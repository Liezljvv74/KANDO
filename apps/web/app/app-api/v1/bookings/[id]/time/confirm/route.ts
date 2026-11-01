import { confirmAgreedTime } from '@kando/domain'
import { appRequest } from '../../../../../../../lib/app-request'

export const POST = appRequest({ auth: 'required' }, async ({ tx, user, params, afterCommit }) => Response.json(await confirmAgreedTime(tx, user!.id, params.id!, new Date(), afterCommit)))
