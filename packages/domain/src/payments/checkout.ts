import { and, eq } from 'drizzle-orm'
import { bookings, db, providers, users } from '@kando/db'
import { DEFAULT_LANG, isLang, t } from '@kando/i18n'
import { isUuid } from '../admin/common'
import { slotIsHeld } from '../bookings/busy'
import { parentNoShow } from '../bookings/additional'
import { emailDateTime, siteBase } from '../notifications'
import type { Exec } from '../providers/eligibility'
import { fail } from '../providers/http'
import { isSuspendedNow } from '../providers/profile'
import { AmountTooSmallError, gateway } from './gateway'
import { belowMinCharge, checkoutExpiry, MAX_PAY_AHEAD_DAYS, toCents } from './rules'

const DAY = 86_400_000
/** A stored session is reused only while it has more than this left: the customer needs time to pay. */
const REUSE_MIN_MS = 5 * 60_000

/** What bookings.checkout_ref holds (staff-only column, owner connection): the open Checkout session, so a second tap reuses it. */
type CheckoutRef = { sessionId: string; url: string; expiresAt: string }
const readRef = (v: string | null): CheckoutRef | null => {
  try {
    return v ? (JSON.parse(v) as CheckoutRef) : null
  } catch {
    return null // an unreadable ref only means a new session
  }
}

/**
 * The Stripe-hosted page where the customer pays the booking's full amount. Customer only (anyone else: 404); the booking
 * must await payment with its deadline ahead (else 409 not-open), start at most MAX_PAY_AHEAD_DAYS away (400 TOO_FAR_AHEAD),
 * its provider published and not suspended (409 provider-unavailable), its time still free (409 slot-pending) and its
 * deadline at least 31 minutes away (409 PAY_WINDOW_TOO_SHORT).
 *
 * No lock is held across the Stripe call. 1) The checks run on the owner connection (amount and checkout_ref are staff
 * only); a stored session with more than 5 minutes left is returned as is. 2) The session is created outside any
 * transaction under a deterministic key: the expiry is checkoutExpiry (never after payBy, the same for every call in one
 * 23-hour step) and the key names that expiry and the language, so two taps at once, or a retry after a crash before
 * checkout_ref was stored, send the same parameters under the same key and Stripe hands back the same session; a new
 * session (the old one about to expire) gets a new key. 3) checkout_ref is stored only while the booking still awaits
 * payment. The slot check here is a courtesy: the webhook re-checks it under the provider lock before confirming, and
 * refunds a payment that lost its time (also if two sessions were ever both paid).
 */
export async function createPayLink(tx: Exec, userId: string, bookingId: string, now = new Date()): Promise<{ url: string }> {
  const mine = isUuid(bookingId) ? (await tx.select({ customerId: bookings.customerId }).from(bookings).where(eq(bookings.id, bookingId)))[0] : undefined
  if (!mine || mine.customerId !== userId) return fail(404, { error: 'Not found' })
  const language = (await db.select({ language: users.language }).from(users).where(eq(users.id, userId)))[0]?.language
  const lang = isLang(language) ? language : DEFAULT_LANG

  const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId))
  if (!b || b.status !== 'awaiting-payment' || !b.payBy || b.payBy <= now) return fail(409, { error: 'not-open' })
  if (b.startAt.getTime() > now.getTime() + MAX_PAY_AHEAD_DAYS * DAY) fail(400, { error: 'TOO_FAR_AHEAD' })
  const [provider] = await db.select({ status: providers.status }).from(providers).where(eq(providers.id, b.providerId))
  if (provider?.status !== 'published' || (await isSuspendedNow(db, b.providerId))) fail(409, { error: 'provider-unavailable' })
  const stored = readRef(b.checkoutRef)
  if (stored && new Date(stored.expiresAt).getTime() > now.getTime() + REUSE_MIN_MS) return { url: stored.url }
  if (b.parentBookingId ? await parentNoShow(db, b) : await slotIsHeld(db, b.providerId, b.startAt, b.durationMin, b.onSite, now, b.id)) fail(409, { error: b.parentBookingId ? 'not-open' : 'slot-pending' }) // a lapsed hold can overlap until the sweep; an additional task has its parent's time
  const expiresAt = checkoutExpiry(b.payBy, now)
  if (!expiresAt) return fail(409, { error: 'PAY_WINDOW_TOO_SHORT' })

  const amountCents = toCents(Number(b.amount))
  if (belowMinCharge(amountCents, b.currency)) return fail(409, { error: 'AMOUNT_TOO_SMALL' })

  const done = `${siteBase()}/payment-done${lang === DEFAULT_LANG ? '' : `?lang=${lang}`}` // nothing of the booking in the address
  let session: { sessionId: string; url: string }
  try {
    session = await gateway().createCheckout({
      bookingId: b.id,
      providerId: b.providerId,
      customerId: b.customerId,
      amountCents, // the booking's amount, never the client's
      currency: b.currency,
      description: t(lang, 'payment.lineItem', { date: emailDateTime(b.startAt, lang) }),
      successUrl: done,
      cancelUrl: done,
      expiresAt,
      idempotencyKey: `checkout:${b.id}:${expiresAt.toISOString()}:${lang}`,
    })
  } catch (e) {
    if (e instanceof AmountTooSmallError) return fail(409, { error: 'AMOUNT_TOO_SMALL' })
    if (e instanceof RangeError) return fail(409, { error: 'PAY_WINDOW_TOO_SHORT' }) // the clock moved past the 31-minute edge
    throw e
  }
  const ref: CheckoutRef = { sessionId: session.sessionId, url: session.url, expiresAt: expiresAt.toISOString() }
  const saved = await db.update(bookings).set({ checkoutRef: JSON.stringify(ref) }).where(and(eq(bookings.id, b.id), eq(bookings.status, 'awaiting-payment'))).returning({ id: bookings.id })
  if (!saved.length) return fail(409, { error: 'not-open' }) // withdrawn or expired meanwhile: a payment through this session is refunded
  return { url: session.url }
}
