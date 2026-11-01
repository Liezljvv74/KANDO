import { and, eq, gt, inArray, sql } from 'drizzle-orm'
import { messages, quotes, threads, type requests, type Tx } from '@kando/db'
import { fail } from '../providers/http'
import { mayPropose } from './rules'

/**
 * The round rule for a request (flow 1): the customer's request is their first proposal and each change of the time one more;
 * a provider quote with another time is the provider's. A side that already proposed needs the other side to have written in
 * the request's chat since its last proposal, else 409 `chat-first`. `other` is the other side's user id (the customer, or the
 * provider's owner). Read under the caller's tx: both parties may read their own thread.
 */
export async function assertMayPropose(tx: Tx, request: typeof requests.$inferSelect, side: 'customer' | 'provider', other: string): Promise<void> {
  const others = await tx.select({ at: quotes.createdAt }).from(quotes).where(and(eq(quotes.requestId, request.id), eq(quotes.proposedOtherTime, true)))
  const customerProposals = 1 + request.revision
  const providerProposals = others.length
  const lastMine = side === 'customer' ? (request.revisedAt ?? request.createdAt) : others.reduce<Date | null>((m, o) => (m && m > o.at ? m : o.at), null)
  const wrote =
    lastMine === null
      ? false
      : ((await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(messages)
          .innerJoin(threads, eq(threads.id, messages.threadId))
          .where(and(eq(threads.requestId, request.id), eq(messages.senderId, other), inArray(messages.kind, ['text', 'photo']), gt(messages.createdAt, lastMine))))[0]!.n > 0)
  const answer = mayPropose({ side, customerProposals, providerProposals, otherWroteSinceMine: wrote })
  if (!answer.ok) fail(409, { error: answer.reason })
}
