import { cancelBooking } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

/** Either side cancels a paid booking before its start. Allowed while suspended: it only ends an existing booking (and refunds the customer). */
export const POST = appRequest({ auth: 'required', allowWhenSuspended: true }, async ({ tx, user, params }) => Response.json(await cancelBooking(tx, user!.id, params.id!)))
