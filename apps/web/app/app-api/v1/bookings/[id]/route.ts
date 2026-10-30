import { getBooking } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'

export const GET = appRequest({ auth: 'required' }, async ({ tx, user, params }) => Response.json(await getBooking(tx, user!.id, params.id!)))
