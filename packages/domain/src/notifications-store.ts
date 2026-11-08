import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { notifications, type Tx } from '@kando/db'
import type { Notification } from '@kando/contract'
import { jobsForNotices } from './bookings/notice-job'
import { isUuid } from './admin/common'
import { ownThread } from './chat/threads'
import type { Exec } from './providers/eligibility'

export type NotificationKind = Notification['kind']

/** Creates an in-app message for the user (owner connection: the app role may not insert). */
export async function createNotification(exec: Exec, userId: string, kind: NotificationKind, payload: { url: string; threadId?: string } | { requestId?: string; bookingId?: string; quoteId?: string; count?: number }): Promise<void> {
  await exec.insert(notifications).values({ userId, kind, payload })
}

/** The caller's undismissed messages, newest first (RLS limits the rows to the caller). */
export async function listNotifications(tx: Tx, userId: string): Promise<Notification[]> {
  const rows = await tx
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.dismissedAt)))
    .orderBy(desc(notifications.createdAt))
    .limit(20)
  const jobs = await jobsForNotices(tx, userId, rows.map((r) => r.payload as { bookingId?: string; requestId?: string }))
  return rows.map((r, i) => ({
    id: r.id,
    kind: r.kind as Notification['kind'],
    payload: r.payload as Notification['payload'],
    createdAt: r.createdAt.toISOString(),
    seenAt: r.seenAt?.toISOString() ?? null,
    dismissedAt: r.dismissedAt?.toISOString() ?? null,
    job: jobs[i] ?? null,
  }))
}

/** Marks the caller's unseen "new message" notices of one chat seen (all of them, not only the newest 20 that /me lists); 404 unless a party. */
export async function markThreadNoticesSeen(tx: Tx, userId: string, threadId: string): Promise<void> {
  await ownThread(tx, threadId)
  await tx
    .update(notifications)
    .set({ seenAt: new Date() })
    .where(and(eq(notifications.userId, userId), eq(notifications.kind, 'message-received'), isNull(notifications.seenAt), sql`${notifications.payload}->>'threadId' = ${threadId}`))
}

/** Marks one of the caller's messages seen and/or dismissed; false when it is not theirs (RLS hides it). */
export async function markNotification(tx: Tx, userId: string, id: string, m: { seen?: true; dismissed?: true }): Promise<boolean> {
  if (!isUuid(id)) return false
  const now = new Date()
  const where = and(eq(notifications.id, id), eq(notifications.userId, userId))
  if (!m.seen && !m.dismissed) return (await tx.select({ id: notifications.id }).from(notifications).where(where)).length > 0
  const rows = await tx
    .update(notifications)
    .set({ ...(m.seen && { seenAt: now }), ...(m.dismissed && { dismissedAt: now }) })
    .where(where)
    .returning({ id: notifications.id })
  return rows.length > 0
}
