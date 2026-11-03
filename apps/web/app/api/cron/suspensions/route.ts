import { db } from '@kando/db'
import { endExpiredSuspensions, flushPendingObjects, pruneOldRows, purgeContactAttempts, purgeExpiredRetained, sweepIdImages, closeInterruptedChecks } from '@kando/domain'
import { cronAuthorized } from '../../../../lib/cron'
import { refreshPublicPages } from '../../../../lib/public-cache'

export const maxDuration = 60

/** Daily check (vercel.json): ends the suspensions whose date has passed and emails "published again"; then retries the stored-file deletes of erased accounts; then removes old notices, webhook events and stale device tokens (retention.ts), blocked contact texts after 90 days, and the photo ID images 30 days after their AI-assisted check (ai/document-check.ts). */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const ended = await endExpiredSuspensions(db)
  refreshPublicPages('providers')
  // Storage may be down: the suspension work above is done and its answer stands; the rows stay for tomorrow.
  const purged = await purgeExpiredRetained().catch((e) => (console.error('[cron] retained records clean-up failed', e instanceof Error ? e.name : 'unknown'), -1))
  const pendingObjects = await flushPendingObjects().catch((e) => (console.error('[cron] object clean-up failed', e instanceof Error ? e.name : 'unknown'), -1))
  const pruned = await pruneOldRows(db, new Date()).catch((e) => (console.error('[cron] old rows clean-up failed', e instanceof Error ? e.name : 'unknown'), null))
  const contactAttempts = await purgeContactAttempts(db, new Date()).catch((e) => (console.error('[cron] contact attempts clean-up failed', e instanceof Error ? e.name : 'unknown'), null))
  const idImages = await sweepIdImages().catch((e) => (console.error('[cron] ID image clean-up failed', e instanceof Error ? e.name : 'unknown'), -1))
  const interruptedChecks = await closeInterruptedChecks().catch((e) => (console.error('[cron] interrupted AI checks clean-up failed', e instanceof Error ? e.name : 'unknown'), -1))
  return Response.json({ ended, pendingObjects, purged, pruned, contactAttempts, idImages, interruptedChecks })
}
