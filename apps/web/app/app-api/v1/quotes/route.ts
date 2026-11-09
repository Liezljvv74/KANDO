import { parseQuery, QuotesQuerySchema } from '@kando/contract'
import { listQuoteDocuments } from '@kando/domain'
import { appRequest } from '@/lib/app-request'

/** The caller's quote documents, as provider ("Quotes sent") and as customer ("My received quotes") (QuoteListSchema); `?requestId=` keeps one request's. Allowed while suspended: they are records. */
export const GET = appRequest({ auth: 'required', allowWhenSuspended: true }, async ({ tx, user, request }) =>
  Response.json({ docs: await listQuoteDocuments(tx, user!.id, new Date(), parseQuery(QuotesQuerySchema, request).requestId) }),
)
