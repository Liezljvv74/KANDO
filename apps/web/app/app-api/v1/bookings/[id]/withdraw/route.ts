import { withdrawBooking } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

export const POST = appRequest({ auth: 'required' }, async ({ tx, user, params }) => Response.json(await withdrawBooking(tx, user!.id, params.id!)))
