import { and, eq, inArray, sql } from 'drizzle-orm'
import { blocks, db, messages, providers, users, type Tx } from '@kando/db'
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

/** Block the other side of a thread the caller belongs to (RLS hides any other thread, and a bad id: 404, so no one can probe who exists). Idempotent. */
export async function blockUser(tx: Tx, userId: string, threadId: string): Promise<void> {
  const t = await ownThread(tx, threadId)
  // owner connection: the provider row may be hidden from the customer
  const ownerId = (await db.select({ o: providers.ownerId }).from(providers).where(eq(providers.id, t.providerId)))[0]?.o
  const otherId = t.customerId === userId ? ownerId : t.customerId
  if (!otherId || otherId === userId) return notFound()
  await tx.insert(blocks).values({ blockerId: userId, blockedId: otherId }).onConflictDoNothing()
}

/** Idempotent. */
export async function unblockUser(tx: Tx, userId: string, otherId: string): Promise<void> {
  await tx.delete(blocks).where(and(eq(blocks.blockerId, userId), eq(blocks.blockedId, otherId)))
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
  return ids.map((id) => {
    const p = byId.get(id)
    const prov = byOwner.get(id)
    return { userId: id, name: prov ? prov.publicName || publicNameFor(p?.first ?? null, p?.last ?? null, prov.businessName, prov.type) : publicNameFor(p?.first ?? null, p?.last ?? null, null, null) }
  })
}

/** True when the caller and the provider's owner blocked each other, either way (callers answer 404: the block is never revealed). */
export async function blockedWithProvider(tx: Tx, userId: string, providerId: string): Promise<boolean> {
  const r = await tx.execute(sql`SELECT is_blocked(${userId}, ${providerId}::uuid) AS b`)
  return r.rows[0]?.b === true
}
