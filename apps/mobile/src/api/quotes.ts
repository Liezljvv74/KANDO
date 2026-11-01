import type { PayLink, QuoteListItem } from '@kando/contract'

import { api } from '@/api/client'

const BASE = '/app-api/v1'

/** The quote documents the caller is a party of: sent as provider, received as customer. */
export const listQuoteDocuments = async () => (await api<{ docs: QuoteListItem[] }>(`${BASE}/quotes`)).docs
/** A fresh signed PDF link for a quote document (its id, not the quote's); a PDF not stored yet is stored when the link is asked for. */
export const quotePdf = (documentId: string) => api<PayLink>(`${BASE}/quotes/${encodeURIComponent(documentId)}/pdf`)
