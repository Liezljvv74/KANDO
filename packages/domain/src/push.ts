import { and, eq, sql } from 'drizzle-orm'
import { db, pushTokens, users, type Tx } from '@kando/db'
import type { PushSettings, PushTokenInput } from '@kando/contract'

/**
 * Saves this device's token for the caller (a session-checked route). One row per token: the same token again only
 * refreshes last_seen_at and the platform; a token another person held (a phone that changed hands) moves to the caller,
 * so that person gets nothing more on this device. Owner connection: the other person's row is invisible under RLS.
 */
export async function savePushToken(userId: string, input: PushTokenInput): Promise<void> {
  await db
    .insert(pushTokens)
    .values({ userId, token: input.token, platform: input.platform })
    .onConflictDoUpdate({ target: pushTokens.token, set: { userId, platform: input.platform, lastSeenAt: sql`now()` } })
}

/** Forgets the token on sign-out; only the caller's own (RLS too). Idempotent. */
export async function removePushToken(tx: Tx, userId: string, token: string): Promise<void> {
  await tx.delete(pushTokens).where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token)))
}

export async function getPushSettings(tx: Tx, userId: string): Promise<PushSettings> {
  const row = (await tx.select({ chat: users.pushChat, reminders: users.pushReminders }).from(users).where(eq(users.id, userId)))[0]!
  return { chat: row.chat, reminders: row.reminders }
}

export async function setPushSettings(tx: Tx, userId: string, patch: Partial<PushSettings>): Promise<PushSettings> {
  if (patch.chat !== undefined || patch.reminders !== undefined) {
    await tx
      .update(users)
      .set({ ...(patch.chat !== undefined && { pushChat: patch.chat }), ...(patch.reminders !== undefined && { pushReminders: patch.reminders }), updatedAt: new Date() })
      .where(eq(users.id, userId))
  }
  return getPushSettings(tx, userId)
}
