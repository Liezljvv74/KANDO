import type { Invoice, PayLink } from '@kando/contract'

import { ApiError } from '@/api/client'
import type { Key } from '@/i18n'
import { isHttps } from '@/lib/safe-url'

/** What the Account tab offers: everyone their invoices and receipts; providers also KANDO's commission invoices and the yearly export. */
export const invoiceEntries = (me: { isProvider: boolean } | null) => {
  const provider = me?.isProvider === true
  return { invoices: true, commission: provider, export: provider }
}

/** The server accepts 2020..next year. */
export const YEAR_MIN = 2020
const thisYear = (now: Date) => now.getFullYear()
/** Any year into the allowed range; not a number means this year. */
export const clampYear = (year: number, now = new Date()) =>
  Number.isFinite(year) ? Math.min(Math.max(Math.trunc(year), YEAR_MIN), thisYear(now) + 1) : thisYear(now)
/** The years the export picker offers, newest first. */
export const exportYears = (now = new Date()) => Array.from({ length: thisYear(now) + 2 - YEAR_MIN }, (_, i) => thisYear(now) + 1 - i)

/** The invoice or receipt of a booking's group (it is issued on the root booking; an additional task points at it), with its label. */
export function invoiceForBooking(list: Invoice[] | undefined, b: { id: string; parentBookingId: string | null }): { invoice: Invoice; label: Key } | null {
  const root = b.parentBookingId ?? b.id
  const invoice = list?.find((i) => i.bookingId === root)
  return invoice ? { invoice, label: invoice.kind === 'receipt' ? 'invoice.receipt' : 'invoice.invoice' } : null
}

/**
 * Opens a PDF: a fresh signed link on every tap (an old one may have expired). A 404 is asked once more (a link that was
 * not there a moment ago); NOT_READY and other errors are thrown for the screen to show.
 */
export async function openPdf(get: () => Promise<PayLink>, open: (url: string) => Promise<unknown>) {
  let link: PayLink
  try {
    link = await get()
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e
    link = await get()
  }
  if (!isHttps(link.url)) throw new ApiError(0, 'network')
  await open(link.url)
}

/** One entry of the Jobs tab's Invoices fold: an invoice, receipt or commission invoice, reduced to what the list shows. */
export type DocEntry = { id: string; commission: boolean; issuedAt: string }

/** Both lists in one, newest first (ISO dates sort as text). */
export const newestFirst = <D extends { issuedAt: string }>(a: D[], b: D[]): D[] => [...a, ...b].sort((x, y) => (x.issuedAt < y.issuedAt ? 1 : x.issuedAt > y.issuedAt ? -1 : 0))

/** The one-line summary of a document; the screen cuts it with an ellipsis (numberOfLines 1). Empty parts are left out. */
export const docLine = (parts: (string | undefined)[]): string => parts.filter(Boolean).join(' · ')
