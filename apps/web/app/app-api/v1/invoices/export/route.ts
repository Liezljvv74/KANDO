import { exportInvoices, yearOf } from '@kando/domain'
import { appRequest } from '../../../../../lib/app-request'

/** The provider's invoices of one calendar year as CSV (?year=YYYY, default this year in the app's time zone); 400 for a bad year. */
export const GET = appRequest({ auth: 'required', allowWhenSuspended: true }, async ({ tx, user, request }) => {
  const raw = new URL(request.url).searchParams.get('year')
  const year = raw === null ? yearOf(new Date()) : /^\d+$/.test(raw) ? Number(raw) : NaN
  const csv = await exportInvoices(tx, user!.id, year)
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="invoices-${year}.csv"`, 'Cache-Control': 'no-store' } })
})
