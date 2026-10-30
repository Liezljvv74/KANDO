import { timingSafeEqual } from 'node:crypto'
import { db } from '@kando/db'
import { runDueTimers } from '@kando/domain'

/**
 * Seconds this function may run. The real limit on the free plan depends on the project's settings (Fluid compute and the
 * function duration in the Vercel dashboard): the owner must check that 60 s is allowed there, or lower this and
 * RELEASE_BUDGET_MS together.
 */
export const maxDuration = 60

/**
 * Daily on the free Vercel plan (a more frequent cron fails every deployment there): "0 5 * * *" in vercel.json.
 * Change it to hourly ("0 * * * *") when the project moves to Vercel Pro: the payment reminders 3 hours before the deadline need an hourly run.
 * The check: expires unanswered requests, quotes, proposals and unpaid bookings, sends the reminders and the ignored-requests
 * notice, the ending steps (confirm reminders, "Was the job done?", no-action disputes) and, last, the automatic payment
 * releases within RELEASE_BUDGET_MS (about half of maxDuration). */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const given = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  // No secret configured: nobody gets in.
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  return Response.json(await runDueTimers(db, new Date()))
}
