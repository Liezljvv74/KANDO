import { listQuoteDocuments } from '@kando/domain'
import { appRequest } from '../../../../lib/app-request'

/** The caller's quote documents, as provider ("Quotes sent") and as customer ("My received quotes") (QuoteListSchema). Allowed while suspended: they are records. */
export const GET = appRequest({ auth: 'required', allowWhenSuspended: true }, async ({ tx, user }) => Response.json({ docs: await listQuoteDocuments(tx, user!.id) }))
