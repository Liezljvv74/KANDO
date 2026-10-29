import { and, eq, isNull, sql } from 'drizzle-orm'
import { availabilityWatches, bookings, db, providers, quotes, users } from '@kando/db'
import { DEFAULT_LANG, isLang } from '@kando/i18n'
import type { AfterCommit } from '../app-request'
import { sendEmail, type BookingTemplate } from '../email'
import { describeError } from '../log-error'
import { createNotification, type NotificationKind } from '../notifications-store'
import { emailDateTime, providerUrl } from '../notifications'
import { slotIsHeld } from './busy'

/** The notification kinds that have an email template (a kind without one cannot be sent from here). */
export type BookingKind = Extract<NotificationKind, BookingTemplate>
/** Kinds whose in-app row the timers (timers.ts, one SQL statement per rule) already write: here they only get the email. */
const WRITTEN_BY_TIMERS: NotificationKind[] = ['request-expired', 'booking-expired', 'quote-expiring', 'payment-reminder', 'requests-ignored', 'customers-waiting']
/** Kinds whose in-app row carries a link (`params.url`, or the provider page of `params.slug`) instead of ids. */
const WITH_URL: NotificationKind[] = ['message-received', 'provider-available']

/** How many customers wait for the provider owned by `userId` (the count only: the email never names them). */
const waitingFor = async (userId: string) =>
  (await db.select({ n: sql<number>`count(*)::int` }).from(availabilityWatches).innerJoin(providers, eq(providers.id, availabilityWatches.providerId)).where(and(eq(providers.ownerId, userId), isNull(availabilityWatches.notifiedAt))))[0]!.n

/** The date an email names, when the caller did not pass one (`params.date`, ISO): the timers pass ids only. */
async function dateOf(kind: BookingKind, params: Record<string, string>): Promise<string | undefined> {
  if (kind === 'quote-expiring' && params.quoteId) return (await db.select({ d: quotes.expiresAt }).from(quotes).where(eq(quotes.id, params.quoteId)))[0]?.d.toISOString()
  if (kind === 'payment-reminder' && params.bookingId) return (await db.select({ d: bookings.payBy }).from(bookings).where(eq(bookings.id, params.bookingId)))[0]?.d?.toISOString()
  return undefined
}

/**
 * One booking event for one user: the email in their language and, unless the timers wrote it, the in-app row (ids only,
 * no personal data; `params.date` is for the email text only). `params.slug` makes the link to that provider's page in the
 * user's language. Runs after commit, on the owner connection; never throws.
 */
export async function notifyBookingEvent(kind: BookingKind, userId: string, params: Record<string, string>): Promise<void> {
  try {
    const [user] = await db.select({ email: users.email, language: users.language }).from(users).where(eq(users.id, userId))
    if (!user) return
    const lang = isLang(user.language) ? user.language : DEFAULT_LANG
    const url = params.slug ? providerUrl(params.slug, lang) : params.url
    if (!WRITTEN_BY_TIMERS.includes(kind)) {
      try {
        const { requestId, bookingId, quoteId, threadId } = params
        await createNotification(db, userId, kind, WITH_URL.includes(kind) && url ? { url, ...(threadId && { threadId }) } : { ...(requestId && { requestId }), ...(bookingId && { bookingId }), ...(quoteId && { quoteId }) })
      } catch (e) {
        console.error('[notify] booking notification failed', describeError(e)) // the email must still go out
      }
    }
    const iso = params.date ?? (await dateOf(kind, params))
    const count = kind === 'customers-waiting' ? String(await waitingFor(userId)) : ''
    await sendEmail({ to: user.email, lang, template: kind, params: { date: iso ? emailDateTime(new Date(iso), lang) : '', url, count } })
  } catch (e) {
    console.error('[notify] booking event failed', describeError(e))
  }
}

/**
 * A customer's new proposal: tells the provider, and when its time overlaps a booking of theirs that still awaits payment
 * (same overlap rule as accepting, read-only), that another customer asked for that time too. The overlap is read on the
 * owner connection after commit: the customer's own transaction cannot see the provider's other bookings.
 */
export function notifyProposal(afterCommit: AfterCommit, provider: { id: string; ownerId: string }, b: typeof bookings.$inferSelect): void {
  afterCommit(async () => {
    await notifyBookingEvent('booking-proposed', provider.ownerId, { bookingId: b.id })
    try {
      if (await slotIsHeld(db, provider.id, b.startAt, b.durationMin, b.onSite, new Date(), b.id, true)) await notifyBookingEvent('pending-slot-requested', provider.ownerId, { bookingId: b.id })
    } catch (e) {
      console.error('[notify] pending slot check failed', describeError(e))
    }
  })
}
