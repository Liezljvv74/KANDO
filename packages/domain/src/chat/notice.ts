import { and, desc, eq, sql } from 'drizzle-orm'
import { db, notifications, providers } from '@kando/db'
import type { AfterCommit } from '../app-request'
import { notifyBookingEvent } from '../bookings/notify'
import { CHAT_EMAIL_THROTTLE_MINUTES } from './rules'

/**
 * Tells the other party of a thread about a new message (in-app row and email, never the text), after commit; at most once per
 * thread and recipient per CHAT_EMAIL_THROTTLE_MINUTES, judged by the latest `message-received` notice of that thread.
 * ponytail: two messages committing at the same instant can both notify; harmless (one extra email).
 */
export function notifyNewMessage(afterCommit: AfterCommit, t: { id: string; customerId: string; providerId: string }, senderId: string, now = new Date()): void {
  afterCommit(async () => {
    const to = senderId === t.customerId ? (await db.select({ o: providers.ownerId }).from(providers).where(eq(providers.id, t.providerId)))[0]?.o : t.customerId
    if (!to) return
    const last = (
      await db
        .select({ at: notifications.createdAt })
        .from(notifications)
        .where(and(eq(notifications.userId, to), eq(notifications.kind, 'message-received'), sql`${notifications.payload}->>'threadId' = ${t.id}`))
        .orderBy(desc(notifications.createdAt))
        .limit(1)
    )[0]
    if (last && now.getTime() - last.at.getTime() < CHAT_EMAIL_THROTTLE_MINUTES * 60_000) return
    await notifyBookingEvent('message-received', to, { url: `skilled://threads/${t.id}`, threadId: t.id })
  })
}
