import { AsyncLocalStorage } from 'node:async_hooks'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db, pushTokens, users, type Tx } from '@kando/db'
import type { PushSettings, PushTokenInput } from '@kando/contract'
import { describeError } from './log-error'
import type { NotificationKind } from './notifications-store'

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

/** Kinds behind the "Chat messages" switch, and behind "Reminders"; every other kind is always pushed. */
export const CHAT_PUSH_KINDS: NotificationKind[] = ['message-received']
export const REMINDER_PUSH_KINDS: NotificationKind[] = ['payment-reminder', 'quote-expiring', 'confirm-reminder']
const EXPO_URL = 'https://exp.host/--/api/v2/push/send'
const CHUNK = 100 // Expo's limit per request
const PUSH_TIMEOUT_MS = 4_000

export type PushMessage = { to: string; title: string; body: string; sound: 'default'; data: { url: string; kind: NotificationKind } }
const outbox: PushMessage[] = []
export const pushOutboxForTests = () => outbox
export const clearPushOutbox = () => {
  outbox.length = 0
}

/** The person's devices for this kind: none when their switch for it is off (or the account is gone). Owner connection. */
async function devicesFor(userId: string, kind: NotificationKind): Promise<string[]> {
  const [u] = await db.select({ chat: users.pushChat, reminders: users.pushReminders }).from(users).where(eq(users.id, userId))
  if (!u || (CHAT_PUSH_KINDS.includes(kind) && !u.chat) || (REMINDER_PUSH_KINDS.includes(kind) && !u.reminders)) return []
  return (await db.select({ token: pushTokens.token }).from(pushTokens).where(eq(pushTokens.userId, userId))).map((r) => r.token)
}

/** Whether a push of this kind would reach a device (switch on and a token): the chat email goes only when it would not. */
export const pushReaches = async (userId: string, kind: NotificationKind): Promise<boolean> => (await devicesFor(userId, kind)).length > 0

type Queued = { userId: string; message: PushMessage }
const batch = new AsyncLocalStorage<Queued[]>()

/**
 * Runs `fn` with every push it causes held back, then sends them all at the end in requests of up to CHUNK messages (the
 * cron: one slow push service then costs one timeout per 100 messages after the run's work, never one per event inside
 * its time budget). Never throws for the pushes.
 */
export async function withPushBatch<T>(fn: () => Promise<T>): Promise<T> {
  const queued: Queued[] = []
  try {
    return await batch.run(queued, fn)
  } finally {
    await deliver(queued)
  }
}

/**
 * Pushes one message to every device of the person, unless their switch for that kind is off. Owner connection (after
 * commit: callers run it once the event is stored). Inside withPushBatch it is queued and sent at the batch's end. Tests
 * record into the outbox and never reach the network. A ticket `DeviceNotRegistered` deletes that token only. Never
 * throws: a failed push must not touch the event that caused it.
 */
export async function sendPush(userId: string, message: { kind: NotificationKind; title: string; body: string; url: string }): Promise<void> {
  try {
    const all: Queued[] = (await devicesFor(userId, message.kind)).map((token) => ({ userId, message: { to: token, title: message.title, body: message.body, sound: 'default', data: { url: message.url, kind: message.kind } } }))
    const queue = batch.getStore()
    if (queue) return void queue.push(...all)
    await deliver(all)
  } catch (e) {
    console.error('[push] send failed', describeError(e))
  }
}

/** Sends the messages in requests of up to CHUNK (each with the timeout); removes tokens Expo reports as gone. Never throws. */
async function deliver(all: Queued[]): Promise<void> {
  try {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return void outbox.push(...all.map((q) => q.message))
    const access = process.env.EXPO_ACCESS_TOKEN
    for (let i = 0; i < all.length; i += CHUNK) {
      const chunk = all.slice(i, i + CHUNK)
      try {
        const res = await fetch(EXPO_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json', ...(access && { authorization: `Bearer ${access}` }) },
          body: JSON.stringify(chunk.map((q) => q.message)),
          signal: AbortSignal.timeout(PUSH_TIMEOUT_MS), // a slow push service never holds up the event that caused it
        })
        if (!res.ok) {
          console.error(`[push] send failed: HTTP ${res.status}`)
          continue
        }
        // tickets come back in the order sent; only a device that is gone for good loses its token
        // a malformed answer only skips this chunk's token clean-up, never the remaining chunks
        const reply = (await res.json().catch(() => null)) as { data?: unknown } | null
        const tickets = (Array.isArray(reply?.data) ? reply.data : []) as ({ status?: string; details?: { error?: string } } | null)[]
        // only the token of the person the message was for (a token that moved on meanwhile stays with its new holder)
        for (const q of chunk.filter((_, j) => tickets[j]?.status === 'error' && tickets[j]?.details?.error === 'DeviceNotRegistered'))
          await db.delete(pushTokens).where(and(eq(pushTokens.userId, q.userId), inArray(pushTokens.token, [q.message.to])))
      } catch (e) {
        console.error('[push] send failed', describeError(e)) // this chunk only: the others still go
      }
    }
  } catch (e) {
    console.error('[push] send failed', describeError(e))
  }
}
