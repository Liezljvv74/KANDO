import { listInvoices } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

/** The caller's invoices and receipts, as customer or provider (InvoiceListSchema). Allowed while suspended: they are records of money paid. */
export const GET = appRequest({ auth: 'required', allowWhenSuspended: true }, async ({ tx, user }) => Response.json({ docs: await listInvoices(tx, user!.id) }))
