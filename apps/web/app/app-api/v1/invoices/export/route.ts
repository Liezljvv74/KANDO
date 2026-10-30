import { exportInvoices, yearOf } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'

/**
 * The provider's invoices of one calendar year as CSV (?year=YYYY, default this year in the app's time zone); 400 BAD_YEAR
 * for a bad year (not digits, out of range, or given twice). Test documents (payments not live) are listed with their number
 * starting `TEST-`, so nobody mistakes them for real ones.
 */
export const GET = appRequest({ auth: 'required', allowWhenSuspended: true }, async ({ tx, user, request }) => {
  const given = new URL(request.url).searchParams.getAll('year')
  const raw = given.length > 1 ? '' : (given[0] ?? null) // ?year=2025&year=2026 is ambiguous: 400
  const year = raw === null ? yearOf(new Date()) : /^\d{1,6}$/.test(raw) ? Number(raw) : NaN
  const csv = await exportInvoices(tx, user!.id, year)
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="invoices-${year}.csv"`, 'Cache-Control': 'no-store' } })
})
