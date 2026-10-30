import { db } from '@kando/db'
import { runExpiryAndReminders } from '@kando/domain'
import { cronAuthorized } from '../../../../lib/cron'

/**
 * Seconds this function may run. The real limit on the free plan depends on the project's settings (Fluid compute and the
 * function duration in the Vercel dashboard): the owner must check that 60 s is allowed there, or lower this and
 * RELEASE_BUDGET_MS together. The same for the money and invoices routes.
 */
export const maxDuration = 60

/**
 * Daily on the free Vercel plan (a more frequent cron fails every deployment there): "0 3 * * *" in vercel.json, then the
 * money route at 4, the invoices route at 5, the suspensions route at 6 (distinct hours keep the order).
 * Change it to hourly ("0 * * * *") when the project moves to Vercel Pro: the payment reminders 3 hours before the deadline need an hourly run.
 * The check: expires unanswered requests, quotes, proposals and unpaid bookings, sends the reminders and the ignored-requests
 * notice, the ending steps (confirm reminders, "Was the job done?", no-action disputes), then their emails (the outbox)
 * within RELEASE_BUDGET_MS (about half of maxDuration). */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  return Response.json(await runExpiryAndReminders(db, new Date()))
}
