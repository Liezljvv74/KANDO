import { beginCancelBooking } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

/** Either side cancels a paid booking before its start; the money settles after the request transaction. Allowed while suspended: it only ends an existing booking (and refunds the customer). */
export const POST = appRequest({ auth: 'required', allowWhenSuspended: true }, async ({ tx, user, params }) => {
  const settle = await beginCancelBooking(tx, user!.id, params.id!)
  return async () => Response.json(await settle())
})
