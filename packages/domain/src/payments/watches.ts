import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { availabilityWatches, db, providers, type Tx } from '@kando/db'
import { blockedWithProvider } from '../chat/blocks'
import { fail } from '../providers/http'
import { isSuspendedNow } from '../providers/profile'
import { canTransact } from './rules'

/**
 * "Notify me when available": the customer's own watch (app connection; RLS keeps it private to them) on a published
 * provider that cannot be booked yet (bookable: 409 ALREADY_BOOKABLE; own profile 400; hidden, unknown or blocked 404).
 * Idempotent; a watch already answered is armed again. The provider is told only the count, by the daily timer (timers.ts).
 */
export async function watchProvider(tx: Tx, userId: string, slug: string): Promise<void> {
  const [p] = await tx.select().from(providers).where(eq(providers.slug, slug))
  if (!p || p.status !== 'published' || (await isSuspendedNow(tx, p.id)) || (await blockedWithProvider(tx, userId, p.id))) return fail(404, { error: 'Not found' })
  if (p.ownerId === userId) fail(400, { error: 'own-service' })
  if (canTransact(p)) fail(409, { error: 'ALREADY_BOOKABLE' })
  await tx
    .insert(availabilityWatches)
    .values({ customerId: userId, providerId: p.id })
    .onConflictDoUpdate({ target: [availabilityWatches.customerId, availabilityWatches.providerId], set: { notifiedAt: null, createdAt: sql`now()` }, setWhere: isNotNull(availabilityWatches.notifiedAt) })
}

/** Removes the caller's watch, if any (also for a provider no longer visible); always succeeds. */
export async function unwatchProvider(tx: Tx, userId: string, slug: string): Promise<void> {
  const id = (await db.select({ id: providers.id }).from(providers).where(eq(providers.slug, slug)))[0]?.id // owner connection: a hidden provider too; nothing is returned
  if (id) await tx.delete(availabilityWatches).where(and(eq(availabilityWatches.customerId, userId), eq(availabilityWatches.providerId, id)))
}
