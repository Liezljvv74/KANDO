import { timingSafeEqual } from 'node:crypto'
import { db } from '@kando/db'
import { endExpiredSuspensions } from '@kando/domain'

/** Daily check (vercel.json): ends the suspensions whose date has passed and emails "published again". */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const given = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  // No secret configured: nobody gets in.
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  return Response.json({ ended: await endExpiredSuspensions(db) })
}
