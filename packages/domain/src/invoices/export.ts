import { asc, eq } from 'drizzle-orm'
import { invoices, type Tx } from '@kando/db'
import { TIME_ZONE } from '@kando/i18n'
import { noFormula, quote } from '../export'
import { fail } from '../providers/http'
import { ownProvider } from '../providers/profile'
import type { InvoiceDraft } from './build'
import { yearOf } from './numbering'

const day = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
const money = (n: number) => n.toFixed(2)

/**
 * The provider's issued invoices of one calendar year (in TIME_ZONE) as CSV with a byte order mark (columns number, date,
 * customer, labour, material, net, vat, gross, currency, kind). Amounts and the customer name come from the stored draft, so
 * they equal the PDF. A person who is not a provider gets the header only. A year outside 2020..next year is 400.
 */
export async function exportInvoices(tx: Tx, userId: string, year: number): Promise<string> {
  if (!Number.isInteger(year) || year < 2020 || year > yearOf(new Date()) + 1) return fail(400, { error: 'BAD_YEAR' })
  const own = await ownProvider(tx, userId)
  // ponytail: reads all of the provider's invoices and filters by year in code (exact zone boundaries); add a range query if a provider ever has thousands
  const rows = own ? await tx.select().from(invoices).where(eq(invoices.providerId, own.id)).orderBy(asc(invoices.issuedAt), asc(invoices.number)) : []
  const lines = rows
    .filter((r) => yearOf(r.issuedAt) === year)
    .map((r) => {
      const d = r.draft as InvoiceDraft
      const x = d.totals
      return [r.number, day.format(r.issuedAt), noFormula(d.recipient.name), money(x.labour), money(x.material), money(x.net), money(x.vat), money(x.gross), r.currency, r.kind]
    })
  return '\uFEFF' + [['number', 'date', 'customer', 'labour', 'material', 'net', 'vat', 'gross', 'currency', 'kind'], ...lines].map((l) => l.map(quote).join(',')).join('\r\n') + '\r\n'
}
