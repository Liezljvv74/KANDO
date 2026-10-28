import { timingSafeEqual } from 'node:crypto'
import { db } from '@kando/db'
import { endExpiredSuspensions, flushPendingObjects, purgeExpiredRetained } from '@kando/domain'

/** Daily check (vercel.json): ends the suspensions whose date has passed and emails "published again"; then retries the stored-file deletes of erased accounts. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const given = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  // No secret configured: nobody gets in.
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const ended = await endExpiredSuspensions(db)
  // Storage may be down: the suspension work above is done and its answer stands; the rows stay for tomorrow.
  const purged = await purgeExpiredRetained().catch((e) => (console.error('[cron] retained records clean-up failed', e instanceof Error ? e.name : 'unknown'), -1))
  const pendingObjects = await flushPendingObjects().catch((e) => (console.error('[cron] object clean-up failed', e instanceof Error ? e.name : 'unknown'), -1))
  return Response.json({ ended, pendingObjects, purged })
}
