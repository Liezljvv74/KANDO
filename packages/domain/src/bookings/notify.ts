import { eq } from 'drizzle-orm'
import { bookings, db, quotes, users } from '@kando/db'
import { DEFAULT_LANG, isLang } from '@kando/i18n'
import type { AfterCommit } from '../app-request'
import { sendEmail, type BookingTemplate } from '../email'
import { describeError } from '../log-error'
import { createNotification, type NotificationKind } from '../notifications-store'
import { emailDateTime } from '../notifications'
import { slotIsHeld } from './busy'

/** The notification kinds that have an email template (a kind without one cannot be sent from here). */
export type BookingKind = Extract<NotificationKind, BookingTemplate>
/** Kinds whose in-app row the timers (timers.ts, one SQL statement per rule) already write: here they only get the email. */
const WRITTEN_BY_TIMERS: NotificationKind[] = ['request-expired', 'booking-expired', 'quote-expiring', 'payment-reminder', 'requests-ignored']

/** The date an email names, when the caller did not pass one (`params.date`, ISO): the timers pass ids only. */
async function dateOf(kind: BookingKind, params: Record<string, string>): Promise<string | undefined> {
  if (kind === 'quote-expiring' && params.quoteId) return (await db.select({ d: quotes.expiresAt }).from(quotes).where(eq(quotes.id, params.quoteId)))[0]?.d.toISOString()
  if (kind === 'payment-reminder' && params.bookingId) return (await db.select({ d: bookings.payBy }).from(bookings).where(eq(bookings.id, params.bookingId)))[0]?.d?.toISOString()
  return undefined
}

/**
 * One booking event for one user: the email in their language and, unless the timers wrote it, the in-app row (ids only,
 * no personal data; `params.date` is for the email text only). Runs after commit, on the owner connection; never throws.
 */
export async function notifyBookingEvent(kind: BookingKind, userId: string, params: Record<string, string>): Promise<void> {
  try {
    const [user] = await db.select({ email: users.email, language: users.language }).from(users).where(eq(users.id, userId))
    if (!user) return
    const lang = isLang(user.language) ? user.language : DEFAULT_LANG
    if (!WRITTEN_BY_TIMERS.includes(kind)) {
      try {
        const { requestId, bookingId, quoteId, url, threadId } = params
        await createNotification(db, userId, kind, kind === 'message-received' && url ? { url, ...(threadId && { threadId }) } : { ...(requestId && { requestId }), ...(bookingId && { bookingId }), ...(quoteId && { quoteId }) })
      } catch (e) {
        console.error('[notify] booking notification failed', describeError(e)) // the email must still go out
      }
    }
    const iso = params.date ?? (await dateOf(kind, params))
    await sendEmail({ to: user.email, lang, template: kind, params: { date: iso ? emailDateTime(new Date(iso), lang) : '' } })
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
      if (await slotIsHeld(db, provider.id, b.startAt, b.durationMin, b.onSite, new Date(), b.id)) await notifyBookingEvent('pending-slot-requested', provider.ownerId, { bookingId: b.id })
    } catch (e) {
      console.error('[notify] pending slot check failed', describeError(e))
    }
  })
}
