import type { Booking } from '@kando/contract'

import type { Viewer } from '@/lib/booking-status'

/** How long "being confirmed" shows after the pay link was opened: the webhook normally lands within seconds. */
export const CONFIRMING_MS = 10 * 60_000

export type PayCardKind = 'paid' | 'pay' | 'payAgain' | 'confirming' | 'expired' | 'none'

/**
 * Which pay card to show. `openedAt`: when this session returned from the pay link (ms, null = never); `gaveUp`: the customer
 * said they did not finish. The server stays the judge: the booking only counts as paid once it is `confirmed`.
 */
export function payCard(b: Pick<Booking, 'status' | 'payBy'>, viewer: Viewer, openedAt: number | null, gaveUp: boolean, now = new Date()): PayCardKind {
  if (viewer !== 'customer') return 'none'
  if (b.status === 'confirmed') return 'paid'
  if (b.status !== 'awaiting-payment') return 'none'
  if (!b.payBy || new Date(b.payBy) <= now) return 'expired'
  if (openedAt === null) return 'pay'
  return !gaveUp && now.getTime() - openedAt < CONFIRMING_MS ? 'confirming' : 'payAgain'
}
