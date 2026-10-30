import { db } from '@kando/db'
import { runMoneySteps } from '@kando/domain'
import { cronAuthorized } from '../../../../lib/cron'

export const maxDuration = 60

/** Daily after the bookings route ("0 4 * * *" in vercel.json): no-shows that stood, the automatic releases and cancelled bookings to settle, within RELEASE_BUDGET_MS; the invoices wait for the invoices route. */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  return Response.json(await runMoneySteps(db, new Date()))
}
