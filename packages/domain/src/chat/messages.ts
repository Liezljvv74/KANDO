import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { db, messages, type Tx } from '@kando/db'
import { MESSAGES_PAGE, type Card, type Message, type MessageInput } from '@kando/contract'
import type { AfterCommit } from '../app-request'
import { describeError } from '../log-error'
import { fail } from '../providers/http'
import type { NormalizedImage } from '../photos'
import { documentsBucket, removeObject, storage } from '../storage'
import { assertNoContactDetails } from './flags'
import { notifyNewMessage } from './notice'
import { CHAT_PHOTO_LINK_SECONDS, MESSAGE_LIMIT, MESSAGE_LIMIT_WINDOW_MINUTES } from './rules'
import { ownThread } from './threads'

type Row = typeof messages.$inferSelect
const PAGE = MESSAGES_PAGE
/** created_at with microseconds, as text: a JS Date would cut them and a cursor on it would repeat a row. */
export const TS = sql<string>`to_char(${messages.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

/** A signed link to a photo of this thread; never signs a key that is not the thread's own. */
export async function chatPhotoLink(threadId: string, key: string | null): Promise<string | null> {
  return key?.startsWith(`chat/${threadId}/`) ? storage().getSignedUrl(documentsBucket(), key, CHAT_PHOTO_LINK_SECONDS) : null
}

async function toMessage(r: Row & { ts: string }, userId: string): Promise<Message> {
  return {
    id: r.id,
    threadId: r.threadId,
    mine: r.senderId === userId,
    kind: r.kind as Message['kind'],
    body: r.body,
    photoUrl: await chatPhotoLink(r.threadId, r.photoKey),
    card: (r.card as Card | null) ?? null,
    createdAt: r.ts,
  }
}

/**
 * 429 MESSAGE_LIMIT once the user sent MESSAGE_LIMIT text and photo messages (all threads, cards excluded) inside the window.
 * The user's advisory lock (held to the end of the transaction) makes parallel sends take turns, so they cannot all pass.
 */
export async function assertSendRate(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('message_limit'), hashtext(${userId}))`)
  const { n } = (await tx.select({ n: sql<number>`count(*)::int` }).from(messages).where(and(
    eq(messages.senderId, userId),
    inArray(messages.kind, ['text', 'photo']),
    sql`${messages.createdAt} > clock_timestamp() - make_interval(mins => ${MESSAGE_LIMIT_WINDOW_MINUTES})`,
  )))[0]!
  if (n >= MESSAGE_LIMIT) fail(429, { error: 'MESSAGE_LIMIT' })
}

/** The thread, for one of its parties; 403 BLOCKED when either side blocked the other (RLS refuses the insert as well); 429 over the send limit. */
async function writableThread(tx: Tx, userId: string, threadId: string) {
  const t = await ownThread(tx, threadId)
  const blocked = (await tx.execute(sql`SELECT is_blocked(${t.customerId}, ${t.providerId}::uuid) AS b`)).rows[0]?.b === true
  if (blocked) fail(403, { error: 'BLOCKED' })
  await assertSendRate(tx, userId)
  return t
}

/**
 * Stamped with clock_timestamp() (the moment of the insert), not the transaction start: a slow transaction (a photo upload) must not
 * give its message an older stamp than a text another side sent and the other side already polled past (the cursor is the stamp).
 * ponytail: a window of milliseconds between this insert and the commit remains; the later fix is a small poll overlap with client-side dedupe by id.
 */
const insertMessage = async (tx: Tx, values: typeof messages.$inferInsert, userId: string) => {
  const [row] = await tx.insert(messages).values({ ...values, createdAt: sql`clock_timestamp()` as unknown as Date }).returning({ id: messages.id })
  return (await listWhere(tx, userId, eq(messages.id, row!.id)))[0]!
}

async function listWhere(tx: Tx, userId: string, where: SQL, limit = PAGE): Promise<Message[]> {
  const rows = await tx.select({ m: messages, ts: TS }).from(messages).where(where).orderBy(asc(messages.createdAt), asc(messages.id)).limit(limit)
  return Promise.all(rows.map((r) => toMessage({ ...r.m, ts: r.ts }, userId)))
}

/** A text message. The contact check runs before anything is stored. */
export async function sendMessage(tx: Tx, userId: string, threadId: string, input: MessageInput, afterCommit: AfterCommit): Promise<Message> {
  const t = await writableThread(tx, userId, threadId)
  await assertNoContactDetails(userId, input.body, t.id)
  const sent = await insertMessage(tx, { threadId: t.id, senderId: userId, kind: 'text', body: input.body }, userId)
  notifyNewMessage(afterCommit, t, userId)
  return sent
}

/** A photo, in the private documents bucket: the object first, then the row; the object is removed once, by the caller's `onFailure`, when the insert or the commit fails. */
export async function sendPhoto(tx: Tx, userId: string, threadId: string, photo: NormalizedImage, afterCommit: AfterCommit, onFailure: AfterCommit = () => {}): Promise<Message> {
  const t = await writableThread(tx, userId, threadId)
  const key = `chat/${t.id}/${randomUUID()}.jpg`
  await storage().put(documentsBucket(), key, photo.data, 'image/jpeg')
  onFailure(() => removeObject(documentsBucket(), key))
  const sent = await insertMessage(tx, { threadId: t.id, senderId: userId, kind: 'photo', photoKey: key }, userId)
  notifyNewMessage(afterCommit, t, userId)
  return sent
}

/** Oldest first, at most 100, after the cursor `<createdAt>|<id>` (each message is returned once even when two share a time). */
export async function listMessages(tx: Tx, userId: string, threadId: string, after?: string): Promise<Message[]> {
  const t = await ownThread(tx, threadId)
  const [ts, id] = after?.split('|') ?? []
  const past = ts && id ? sql`(${messages.createdAt}, ${messages.id}) > (${ts}::timestamptz, ${id}::uuid)` : undefined
  return listWhere(tx, userId, and(eq(messages.threadId, t.id), past)!)
}

/**
 * A card (quote, acceptance, ...) in a thread, written on the owner connection: the app role cannot insert cards, so a party
 * cannot forge one. Call it in afterCommit; a failure is logged and never breaks the action that caused it.
 */
export async function postCard(threadId: string, senderId: string, card: Card): Promise<void> {
  try {
    await db.insert(messages).values({ threadId, senderId, kind: 'card', card, createdAt: sql`clock_timestamp()` as unknown as Date })
  } catch (e) {
    console.error(`[chat] could not post a ${card.type} card to thread ${threadId} ${describeError(e)}`)
  }
}
