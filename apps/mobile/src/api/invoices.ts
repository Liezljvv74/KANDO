import type { CommissionInvoice, Invoice, PayLink } from '@kando/contract'

import { api, ApiError } from '@/api/client'

const BASE = '/app-api/v1'

/** The invoices and receipts the caller is a party of (as customer, and as provider). */
export const listInvoices = async () => (await api<{ docs: Invoice[] }>(`${BASE}/invoices`)).docs
/** A fresh signed PDF link (10 minutes); 404 for anyone but the two parties, 409 NOT_READY before the PDF exists. */
export const invoicePdf = (id: string) => api<PayLink>(`${BASE}/invoices/${encodeURIComponent(id)}/pdf`)
/** KANDO's monthly commission invoices to the caller's provider. */
export const listCommissionInvoices = async () => (await api<{ docs: CommissionInvoice[] }>(`${BASE}/commission-invoices`)).docs
export const commissionInvoicePdf = (id: string) => api<PayLink>(`${BASE}/commission-invoices/${encodeURIComponent(id)}/pdf`)

/** The provider's invoices of one year as CSV text (400 BAD_YEAR outside 2020..next year). An empty answer is a failed read, never something to share. */
export async function exportInvoices(year: number): Promise<string> {
  const csv = await api<string>(`${BASE}/invoices/export?year=${year}`, { text: true })
  if (csv == null || csv === '') throw new ApiError(0, 'network')
  return csv
}
