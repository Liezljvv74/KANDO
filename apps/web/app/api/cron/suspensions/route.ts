import { db } from '@kando/db'
import { endExpiredSuspensions, flushPendingObjects, pruneOldRows, purgeExpiredRetained } from '@kando/domain'
import { cronAuthorized } from '../../../../lib/cron'

export const maxDuration = 60

/** Daily check (vercel.json): ends the suspensions whose date has passed and emails "published again"; then retries the stored-file deletes of erased accounts; then removes old notices, webhook events and stale device tokens (retention.ts). */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const ended = await endExpiredSuspensions(db)
  // Storage may be down: the suspension work above is done and its answer stands; the rows stay for tomorrow.
  const purged = await purgeExpiredRetained().catch((e) => (console.error('[cron] retained records clean-up failed', e instanceof Error ? e.name : 'unknown'), -1))
  const pendingObjects = await flushPendingObjects().catch((e) => (console.error('[cron] object clean-up failed', e instanceof Error ? e.name : 'unknown'), -1))
  const pruned = await pruneOldRows(db, new Date()).catch((e) => (console.error('[cron] old rows clean-up failed', e instanceof Error ? e.name : 'unknown'), null))
  return Response.json({ ended, pendingObjects, purged, pruned })
}
