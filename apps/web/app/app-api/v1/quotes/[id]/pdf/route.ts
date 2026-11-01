import { quotePdfUrl } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

/** A signed download link for one quote document (600 seconds); 404 for anyone but its two parties, 409 NOT_READY before the PDF exists. */
export const GET = appRequest({ auth: 'required', allowWhenSuspended: true }, async ({ tx, user, params }) => Response.json(await quotePdfUrl(tx, user!.id, params.id!)))
