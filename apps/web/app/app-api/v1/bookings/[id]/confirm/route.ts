import { confirmJob } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

/** The customer's "the job is done": releases the payment. Allowed while suspended: it only settles an existing booking. */
export const POST = appRequest({ auth: 'required', allowWhenSuspended: true }, async ({ tx, user, params }) => Response.json(await confirmJob(tx, user!.id, params.id!)))
