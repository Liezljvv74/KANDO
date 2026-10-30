import { commissionInvoicePdfUrl } from '@kando/domain'
import { appRequest } from '../../../../../../lib/app-request'

/** A signed download link for one commission invoice (CommissionInvoicePdfSchema, 600 seconds); 404 for anyone but the provider. */
export const GET = appRequest({ auth: 'required', allowWhenSuspended: true }, async ({ tx, user, params }) => Response.json(await commissionInvoicePdfUrl(tx, user!.id, params.id!)))
