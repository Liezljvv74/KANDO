import { reportNoShow } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

/** Either side reports that the other did not turn up. Allowed while suspended: it only ends an existing booking. */
export const POST = appRequest({ auth: 'required', allowWhenSuspended: true }, async ({ tx, user, params }) => Response.json(await reportNoShow(tx, user!.id, params.id!)))
