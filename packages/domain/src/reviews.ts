import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { db, notifications, providers, reviews, type Tx } from '@kando/db'
import { DAY, type Rating, type Review, type ReviewInput } from '@kando/contract'
import { isUuid } from './admin/common'
import { lockRow, partyOf } from './bookings/party'
import { notifyBookingEvent } from './bookings/notify'
import { canEditReview, REVIEW_VISIBLE_DAYS, reviewFinalAt, reviewVisibleAt } from './bookings/ending-rules'
import { assertNoContactDetails } from './chat/flags'
import type { Exec } from './providers/eligibility'
import { fail, notFound } from './providers/http'

type Row = typeof reviews.$inferSelect
const textOf = (t: string | undefined) => (t ? t : null)

const toReview = (r: Row, userId: string): Review => {
  const mine = r.authorId === userId
  return {
    id: r.id,
    bookingId: r.bookingId,
    mine,
    authorRole: r.authorRole as Review['authorRole'],
    stars: r.stars,
    text: r.text,
    createdAt: r.createdAt.toISOString(),
    visibleAt: r.visibleAt?.toISOString() ?? null,
    editableUntil: mine ? reviewFinalAt(r.createdAt, r.visibleAt).toISOString() : null,
    hidden: r.hidden,
  }
}

/**
 * One review of the other side of a `completed` root booking (an additional task is reviewed with its root: one review per
 * job), by either party (a third person 404), once (409 REVIEW_EXISTS), before the reveal 7 days after completion (409
 * REVIEW_CLOSED; any other status or a child booking 409 not-open). No contact details in the text (422). The first review
 * waits hidden until `completedAt + 7 days`; the second shows both at once (`visibleAt = now`) and tells both sides
 * (`review-visible`: in-app row here, email and push after commit). Owner connection with the booking row locked, so two racing writes see each other: the second
 * always reveals both. Blocked while suspended (the route): a suspension is for misbehaviour, and a review is not about money.
 */
export async function writeReview(tx: Tx, userId: string, bookingId: string, input: ReviewInput, now = new Date()): Promise<Review> {
  const side = (await partyOf(tx, userId, bookingId)).role
  if (input.text) await assertNoContactDetails(userId, input.text)
  const row = await db.transaction(async (o) => {
    const b = await lockRow(o, bookingId)
    if (b.status !== 'completed' || b.parentBookingId || !b.completedAt) fail(409, { error: 'not-open' })
    if (now.getTime() >= b.completedAt!.getTime() + REVIEW_VISIBLE_DAYS * DAY) fail(409, { error: 'REVIEW_CLOSED' })
    const owner = (await o.select({ id: providers.ownerId }).from(providers).where(eq(providers.id, b.providerId)))[0]!.id
    const other = (await o.select({ id: reviews.id }).from(reviews).where(and(eq(reviews.bookingId, b.id), ne(reviews.authorId, userId))))[0]
    const [r] = await o
      .insert(reviews)
      .values({ bookingId: b.id, authorId: userId, subjectId: side === 'customer' ? owner : b.customerId, authorRole: side, stars: input.stars, text: textOf(input.text), createdAt: now, updatedAt: now, visibleAt: reviewVisibleAt(b.completedAt!, !!other, now) })
      .onConflictDoNothing()
      .returning()
    if (!r) return fail(409, { error: 'REVIEW_EXISTS' })
    if (other) {
      await o.update(reviews).set({ visibleAt: now, revealToldAt: now }).where(inArray(reviews.id, [other.id, r.id]))
      await o.insert(notifications).values([b.customerId, owner].map((u) => ({ userId: u, kind: 'review-visible', payload: { bookingId: b.id }, createdAt: now })))
    }
    return { r, told: other ? [b.customerId, owner] : [] }
  })
  for (const u of row.told) await notifyBookingEvent('review-visible', u, { bookingId }, { written: true }) // the row is written above: email and push, after commit
  return toReview(row.r, userId)
}

/**
 * The author changes stars or text until the review is final (reviewFinalAt: shown to the other side, or 14 days after
 * writing, whichever first; else 409 REVIEW_FINAL), so nobody edits after reading the other side's. Anyone else 404.
 * Owner connection, the review row locked: an edit racing the second review either commits before the reveal or is refused.
 */
export async function editReview(tx: Tx, userId: string, reviewId: string, input: ReviewInput, now = new Date()): Promise<Review> {
  const own = isUuid(reviewId) ? (await tx.select().from(reviews).where(and(eq(reviews.id, reviewId), eq(reviews.authorId, userId))))[0] : undefined
  if (!own) return notFound()
  if (input.text) await assertNoContactDetails(userId, input.text)
  const r = await db.transaction(async (o) => {
    const [cur] = await o.select().from(reviews).where(eq(reviews.id, own.id)).for('update')
    // both in = shown, even if this request's clock was read a moment before the other review revealed it
    const bothIn = (await o.select({ id: reviews.id }).from(reviews).where(and(eq(reviews.bookingId, own.bookingId), ne(reviews.authorId, userId)))).length > 0
    if (!cur || bothIn || !canEditReview(cur.createdAt, cur.visibleAt, now)) fail(409, { error: 'REVIEW_FINAL' })
    return (await o.update(reviews).set({ stars: input.stars, text: textOf(input.text), updatedAt: now }).where(eq(reviews.id, own.id)).returning())[0]!
  })
  return toReview(r, userId)
}

/**
 * The reviews the caller wrote, and those about them that are shown (not hidden, `visibleAt` reached: RLS checks the same
 * against the database clock), newest first.
 */
export async function listMyReviews(tx: Tx, userId: string, now = new Date()): Promise<Review[]> {
  const rows = await tx
    .select()
    .from(reviews)
    .where(sql`${reviews.authorId} = ${userId} OR (${reviews.subjectId} = ${userId} AND NOT ${reviews.hidden} AND ${reviews.visibleAt} <= ${now.toISOString()}::timestamptz)`)
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
  return rows.map((r) => toReview(r, userId))
}

const shown = sql`NOT ${reviews.hidden} AND ${reviews.visibleAt} <= now()`

/** Average stars (one decimal) and count of the shown reviews about each person, by the given side. */
export async function ratingsOf(exec: Exec, subjectIds: string[], authorRole: 'customer' | 'provider'): Promise<Map<string, Rating>> {
  if (!subjectIds.length) return new Map()
  const rows = await exec
    .select({ id: reviews.subjectId, average: sql<string>`round(avg(${reviews.stars}), 1)`, count: sql<number>`count(*)::int` })
    .from(reviews)
    .where(and(inArray(reviews.subjectId, subjectIds), eq(reviews.authorRole, authorRole), shown))
    .groupBy(reviews.subjectId)
  return new Map(rows.map((r) => [r.id, { average: Number(r.average), count: r.count }]))
}

/** A provider's rating from customers' shown reviews; null when there are none. */
export async function providerRating(exec: Exec, providerId: string): Promise<Rating | null> {
  const owner = (await exec.select({ id: providers.ownerId }).from(providers).where(eq(providers.id, providerId)))[0]?.id
  return owner ? ((await ratingsOf(exec, [owner], 'customer')).get(owner) ?? null) : null
}

/** The latest shown customer reviews of a provider's owner: stars, text and the date shown, nothing else. */
export async function latestReviews(exec: Exec, ownerId: string, limit = 10) {
  const rows = await exec
    .select({ stars: reviews.stars, text: reviews.text, visibleAt: reviews.visibleAt })
    .from(reviews)
    .where(and(eq(reviews.subjectId, ownerId), eq(reviews.authorRole, 'customer'), shown))
    .orderBy(desc(reviews.visibleAt), desc(reviews.id))
    .limit(limit)
  return rows.map((r) => ({ stars: r.stars, text: r.text, date: r.visibleAt!.toISOString() }))
}
