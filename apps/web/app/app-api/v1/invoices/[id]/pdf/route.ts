import { invoicePdfUrl } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

/** A signed download link for one invoice (InvoicePdfSchema, 600 seconds); 404 for anyone but its two parties. */
export const GET = appRequest({ auth: 'required', allowWhenSuspended: true }, async ({ tx, user, params }) => Response.json(await invoicePdfUrl(tx, user!.id, params.id!)))
