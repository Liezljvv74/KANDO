import { timingSafeEqual } from 'node:crypto'
import { db } from '@kando/db'
import { runDueTimers } from '@kando/domain'

/** Hourly check (vercel.json): expires unanswered requests, quotes, proposals and unpaid bookings, sends the reminders and the ignored-requests notice. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const given = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  // No secret configured: nobody gets in.
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  return Response.json(await runDueTimers(db, new Date()))
}
