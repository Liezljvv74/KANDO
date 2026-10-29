import { and, desc, eq, isNull } from 'drizzle-orm'
import { notifications, type Tx } from '@kando/db'
import type { Notification } from '@kando/contract'
import { isUuid } from './admin/common'
import type { Exec } from './providers/eligibility'

export type NotificationKind = Notification['kind']

/** Creates an in-app message for the user (owner connection: the app role may not insert). */
export async function createNotification(exec: Exec, userId: string, kind: NotificationKind, payload: { url: string; threadId?: string } | { requestId?: string; bookingId?: string; quoteId?: string }): Promise<void> {
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
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as Notification['kind'],
    payload: r.payload as Notification['payload'],
    createdAt: r.createdAt.toISOString(),
    seenAt: r.seenAt?.toISOString() ?? null,
    dismissedAt: r.dismissedAt?.toISOString() ?? null,
  }))
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
