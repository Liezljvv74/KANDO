import { eq } from 'drizzle-orm'
import { bookings, type Tx } from '@kando/db'
import { isUuid } from '../admin/common'
import type { Exec } from '../providers/eligibility'
import { notFound } from '../providers/http'
import { ownProvider } from '../providers/profile'

/** Which side the caller is on, read on the request transaction (RLS proves they are a party); 404 for anyone else. */
export async function partyOf(tx: Tx, userId: string, bookingId: string): Promise<{ role: 'customer' | 'provider'; providerId: string }> {
  const b = isUuid(bookingId) ? (await tx.select({ customerId: bookings.customerId, providerId: bookings.providerId }).from(bookings).where(eq(bookings.id, bookingId)))[0] : undefined
  if (!b) return notFound()
  const role = b.customerId === userId ? 'customer' : (await ownProvider(tx, userId))?.id === b.providerId ? 'provider' : null
  return role ? { role, providerId: b.providerId } : notFound()
}

/** The booking row, locked FOR UPDATE until the transaction ends; 404 when it is gone. */
export const lockRow = async (o: Exec, id: string) => (await o.select().from(bookings).where(eq(bookings.id, id)).for('update'))[0] ?? notFound()
