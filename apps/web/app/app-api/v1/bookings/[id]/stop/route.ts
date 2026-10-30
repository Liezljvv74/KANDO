import { stopJob } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

/** Either side stops a paid job. Allowed while suspended: it only ends an existing booking (no money moves). */
export const POST = appRequest({ auth: 'required', allowWhenSuspended: true }, async ({ tx, user, params }) => Response.json(await stopJob(tx, user!.id, params.id!)))
