import { z } from 'zod'

/** POST /bookings/:id/pay: the Stripe-hosted page where the customer pays the booking. */
export const PayLinkSchema = z.object({ url: z.string().url() })
export type PayLink = z.infer<typeof PayLinkSchema>

/** POST /payouts/setup: a fresh Stripe-hosted payout set-up link (same shape as the pay link). */
export const PayoutSetupSchema = PayLinkSchema
/** GET /payouts/status: whether the caller's payout set-up is complete. */
export const PayoutStatusSchema = z.object({ ready: z.boolean() })
export type PayoutStatus = z.infer<typeof PayoutStatusSchema>

/** GET /invoices: an issued invoice or receipt the caller is a party of (no money references). `pdfReady` false until its PDF is stored. */
export const InvoiceSchema = z.object({
  id: z.string(),
  number: z.string(),
  kind: z.enum(['invoice', 'receipt']),
  /** the caller's side */
  role: z.enum(['customer', 'provider']),
  bookingId: z.string(),
  issuedAt: z.string(),
  total: z.number(),
  currency: z.string(),
  /** the other party's name as printed on the invoice */
  counterparty: z.string(),
  pdfReady: z.boolean(),
})
export type Invoice = z.infer<typeof InvoiceSchema>
export const InvoiceListSchema = z.object({ docs: z.array(InvoiceSchema) })
/** GET /invoices/:id/pdf: a signed download link (600 seconds). */
export const InvoicePdfSchema = PayLinkSchema
