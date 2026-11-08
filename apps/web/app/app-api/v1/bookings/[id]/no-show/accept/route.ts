import { beginAcceptNoShow } from '@kando/domain'
import { appRequest } from '../../../../../../../lib/app-request'

/** The reported side accepts a no-show report (no body): the booking ends now; the money settles after the request transaction. Allowed while suspended: a person must be able to answer a report. */
export const POST = appRequest({ auth: 'required', allowWhenSuspended: true }, async ({ tx, user, params }) => {
  const settle = await beginAcceptNoShow(tx, user!.id, params.id!)
  return async () => Response.json(await settle())
})
