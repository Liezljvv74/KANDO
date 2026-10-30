import { beginConfirmJob } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

/** The customer's "the job is done": releases the payment (after the request transaction). Allowed while suspended: it only settles an existing booking. */
export const POST = appRequest({ auth: 'required', allowWhenSuspended: true }, async ({ tx, user, params }) => {
  const release = await beginConfirmJob(tx, user!.id, params.id!)
  return async () => Response.json(await release())
})
