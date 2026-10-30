import { listCommissionInvoices } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

/** The caller's commission invoices as a provider (CommissionInvoiceListSchema). Allowed while suspended: they are records of money kept. */
export const GET = appRequest({ auth: 'required', allowWhenSuspended: true }, async ({ tx, user }) => Response.json({ docs: await listCommissionInvoices(tx, user!.id) }))
