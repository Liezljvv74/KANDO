import { db } from '@kando/db'
import { runDocuments } from '@kando/domain'
import { cronAuthorized } from '../../../../lib/cron'

export const maxDuration = 60

/** Daily after the money route ("0 5 * * *" in vercel.json): the invoices and receipts due, the monthly commission invoices, within RELEASE_BUDGET_MS of its own. */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  return Response.json(await runDocuments(db, new Date()))
}
