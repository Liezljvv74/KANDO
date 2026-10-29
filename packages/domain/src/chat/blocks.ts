import { and, eq, inArray, sql } from 'drizzle-orm'
import { blocks, db, messages, providers, threads, users, type Tx } from '@kando/db'
import type { BlockedUser, ReportInput } from '@kando/contract'
import { isUuid } from '../admin/common'
import { fail } from '../providers/http'
import { publicNameFor } from '../providers/public-name'
import { flagForStaff } from './flags'
import { ownThread } from './threads'

const notFound = () => fail(404, { error: 'Not found' })

/** Report a message of a thread the caller is a party of (RLS hides any other: 404), not their own. Staff-only flag, one open per reporter and message. */
export async function reportMessage(tx: Tx, userId: string, messageId: string, input: ReportInput): Promise<void> {
  const m = isUuid(messageId) ? (await tx.select({ senderId: messages.senderId }).from(messages).where(eq(messages.id, messageId)))[0] : undefined
  if (!m) return notFound()
  if (m.senderId === userId) fail(400, { error: 'own-message' })
  await flagForStaff(db, { kind: 'message-reported', refId: messageId, userId, note: input.reason })
}

/** The other side of a thread the caller belongs to (RLS hides any other thread, and a bad id: 404, so no one can probe who exists). */
async function otherSide(tx: Tx, userId: string, threadId: string): Promise<string> {
  const t = await ownThread(tx, threadId)
  // owner connection: the provider row may be hidden from the customer
  const ownerId = (await db.select({ o: providers.ownerId }).from(providers).where(eq(providers.id, t.providerId)))[0]?.o
  const otherId = t.customerId === userId ? ownerId : t.customerId
  return !otherId || otherId === userId ? notFound() : otherId
}

/** Block the other side of one of the caller's threads. Idempotent. */
export async function blockUser(tx: Tx, userId: string, threadId: string): Promise<void> {
  await tx.insert(blocks).values({ blockerId: userId, blockedId: await otherSide(tx, userId, threadId) }).onConflictDoNothing()
}

/** Remove the caller's own block of the other side of one of their threads (never someone else's block). Idempotent. */
export async function unblockUser(tx: Tx, userId: string, threadId: string): Promise<void> {
  await tx.delete(blocks).where(and(eq(blocks.blockerId, userId), eq(blocks.blockedId, await otherSide(tx, userId, threadId))))
}

/** The caller's blocks (RLS: only their own) with the name the app shows for each person; never an email. */
export async function listBlocks(tx: Tx, userId: string): Promise<BlockedUser[]> {
  const rows = await tx.select({ id: blocks.blockedId }).from(blocks).where(eq(blocks.blockerId, userId)).orderBy(blocks.createdAt)
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const people = await db.select({ id: users.id, first: users.firstName, last: users.lastName }).from(users).where(inArray(users.id, ids))
  const owned = await db.select().from(providers).where(inArray(providers.ownerId, ids))
  const byId = new Map(people.map((p) => [p.id, p]))
  const byOwner = new Map(owned.map((p) => [p.ownerId, p]))
  // the caller's own threads (RLS) with each blocked person
  const mine = await tx.select({ id: threads.id, customerId: threads.customerId, providerId: threads.providerId }).from(threads)
  const ownerOf = new Map((await db.select({ id: providers.id, o: providers.ownerId }).from(providers).where(inArray(providers.id, [...new Set(mine.map((t) => t.providerId))]))).map((p) => [p.id, p.o]))
  const threadIds = (id: string) => mine.filter((t) => (t.customerId === userId ? ownerOf.get(t.providerId) : t.customerId) === id).map((t) => t.id)
  return ids.map((id) => {
    const p = byId.get(id)
    const prov = byOwner.get(id)
    return { userId: id, threadIds: threadIds(id), name: prov ? prov.publicName || publicNameFor(p?.first ?? null, p?.last ?? null, prov.businessName, prov.type) : publicNameFor(p?.first ?? null, p?.last ?? null, null, null) }
  })
}

/** True when the caller and the provider's owner blocked each other, either way (callers answer 404: the block is never revealed). */
export async function blockedWithProvider(tx: Tx, userId: string, providerId: string): Promise<boolean> {
  const r = await tx.execute(sql`SELECT is_blocked(${userId}, ${providerId}::uuid) AS b`)
  return r.rows[0]?.b === true
}
