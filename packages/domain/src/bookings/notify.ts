import { eq } from 'drizzle-orm'
import { bookings, db, quotes, users } from '@kando/db'
import { DEFAULT_LANG, isLang, t, type Key } from '@kando/i18n'
import type { AfterCommit } from '../app-request'
import { sendEmail, type BookingTemplate, type Template } from '../email'
import { describeError } from '../log-error'
import { createNotification, type NotificationKind } from '../notifications-store'
import { emailDateTime, providerUrl } from '../notifications'
import { pushReaches, sendPush } from '../push'
import { slotIsHeld } from './busy'

/** The notification kinds that have an email template (a kind without one cannot be sent from here). */
export type BookingKind = Extract<NotificationKind, BookingTemplate>
/** Kinds whose in-app row carries a link (`params.url`, or the provider page of `params.slug`) instead of ids. */
const WITH_URL: NotificationKind[] = ['message-received', 'provider-available', 'commission-invoice-ready']


/** Kinds about a request whose booking (if named) has ended: they open the request. */
const REQUEST_SCREEN: NotificationKind[] = ['request-withdrawn', 'request-declined', 'request-reopened']

/** The app screen a push opens: the booking, the request, the provider, the thread (`params.url`), else the profile tab. */
const appUrl = (kind: NotificationKind, p: Record<string, string>): string =>
  p.bookingId && !(REQUEST_SCREEN.includes(kind) && p.requestId) ? `skilled://bookings/${p.bookingId}`
  : p.requestId ? `skilled://bookings/request/${p.requestId}`
  : p.slug ? `skilled://provider/${p.slug}`
  : p.url?.startsWith('skilled://') ? p.url
  : 'skilled://my-profile'

/** The date an email names, when the caller did not pass one (`params.date`, ISO): the timers pass ids only. */
async function dateOf(kind: BookingKind, params: Record<string, string>): Promise<string | undefined> {
  if (kind === 'quote-expiring' && params.quoteId) return (await db.select({ d: quotes.expiresAt }).from(quotes).where(eq(quotes.id, params.quoteId)))[0]?.d.toISOString()
  if (kind === 'confirm-reminder' && params.bookingId) return (await db.select({ d: bookings.confirmBy }).from(bookings).where(eq(bookings.id, params.bookingId)))[0]?.d?.toISOString()
  if (kind === 'request-reopened' && params.bookingId) return (await db.select({ d: quotes.expiresAt }).from(bookings).innerJoin(quotes, eq(quotes.id, bookings.quoteId)).where(eq(bookings.id, params.bookingId)))[0]?.d.toISOString()
  if (kind === 'payment-reminder' && params.bookingId) return (await db.select({ d: bookings.payBy }).from(bookings).where(eq(bookings.id, params.bookingId)))[0]?.d?.toISOString()
  return undefined
}

/**
 * One booking event for one user: the email in their language and, unless `opts.written` (the caller already wrote the row:
 * the timers' outbox (outbox.ts), payments/watches.ts, reviews.ts, invoices/issue.ts together with the PDF key), the in-app
 * row (ids only, no personal data; `params.date` is for the email text only). `params.slug` makes the link to that provider's page in the
 * user's language. `params.role = 'provider'` gives `payment-released` the provider's text (the payout is on its way),
 * `params.variant = 'stop'` its text for an agreed stop (the rest is refunded);
 * `params.variant` picks the `booking-cancelled` text (cancel.ts); `params.reason` is staff's written reason (dispute-decided,
 * refund-issued: in the email only, never in the in-app row; `role = 'provider'` gives refund-issued the provider's text). Then the
 * push (generic text per kind, no params: never chat text, contact data or amounts). A new message is emailed only when no push
 * reaches the person (no token, or the chat switch off). Runs after commit, on the owner connection; never throws.
 */
export async function notifyBookingEvent(kind: BookingKind, userId: string, params: Record<string, string>, opts: { written?: boolean } = {}): Promise<void> {
  try {
    if (kind === 'customers-waiting' && !(Number(params.count) > 0)) return // the count only, and never "0 customers"
    const [user] = await db.select({ email: users.email, language: users.language }).from(users).where(eq(users.id, userId))
    if (!user) return
    const lang = isLang(user.language) ? user.language : DEFAULT_LANG
    const url = params.slug ? providerUrl(params.slug, lang) : params.url
    if (!opts.written) {
      try {
        const { requestId, bookingId, quoteId, threadId } = params
        await createNotification(db, userId, kind, WITH_URL.includes(kind) && url ? { url, ...(threadId && { threadId }) } : { ...(requestId && { requestId }), ...(bookingId && { bookingId }), ...(quoteId && { quoteId }) })
      } catch (e) {
        console.error('[notify] booking notification failed', describeError(e)) // the email must still go out
      }
    }
    const iso = params.date ?? (await dateOf(kind, params))
    const template: Template =
      kind === 'additional-task-requested' && params.role === 'provider' ? 'additional-task-requested-provider'
      : kind === 'payment-released' ? (`payment-released${params.variant ? `-${params.variant}` : ''}${params.role === 'provider' ? '-provider' : ''}` as Template)
      : kind === 'booking-cancelled' && params.variant ? (`booking-cancelled-${params.variant}` as Template)
      : kind === 'refund-issued' && params.role === 'provider' ? 'refund-issued-provider'
      : kind
    if (kind !== 'message-received' || !(await pushReaches(userId, kind))) {
      await sendEmail({ to: user.email, lang, template, params: { date: iso ? emailDateTime(new Date(iso), lang) : '', url, count: params.count, reason: params.reason } })
    }
    // invoice-ready names what the provider issued: an invoice, or (private providers) a receipt
    const push = kind === 'invoice-ready' && params.variant === 'receipt' ? 'invoice-ready.receipt' : kind
    await sendPush(userId, { kind, title: t(lang, `push.${push}.title` as Key), body: t(lang, `push.${push}.body` as Key), url: appUrl(kind, params) })
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
