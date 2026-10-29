import { eq } from 'drizzle-orm'
import { bookings, db, users } from '@kando/db'
import { DEFAULT_LANG, isLang, t } from '@kando/i18n'
import { isUuid } from '../admin/common'
import { assertSlotFree, lockProviderSlots } from '../bookings/busy'
import { emailDateTime, siteBase } from '../notifications'
import type { Exec } from '../providers/eligibility'
import { fail } from '../providers/http'
import { gateway } from './gateway'
import { checkoutExpiry, MAX_PAY_AHEAD_DAYS, toCents } from './rules'

const DAY = 86_400_000

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
 * its time still free (409 slot-pending) and its deadline at least 31 minutes away (409 PAY_WINDOW_TOO_SHORT).
 *
 * Everything after the party check runs on the owner connection (amount and checkout_ref are staff only) in one
 * transaction holding the provider's slot lock and the booking row, so a double tap waits and then reuses the stored
 * session. The session's expiry is checkoutExpiry (never after payBy, the same for every call in one 23-hour step), and
 * the idempotency key names that expiry and the language: a retry after a crash before checkout_ref was stored sends
 * the same parameters under the same key, so Stripe hands back the same session; a new session (the old one expired)
 * gets a new key. Should two sessions ever both be paid, the webhook refunds the second payment.
 * ponytail: the locks are held during the Stripe call (15 s timeout, two retries); move the call out of the
 * transaction if a provider's accepts ever queue behind it.
 */
export async function createPayLink(tx: Exec, userId: string, bookingId: string, now = new Date()): Promise<{ url: string }> {
  const mine = isUuid(bookingId) ? (await tx.select({ customerId: bookings.customerId, providerId: bookings.providerId }).from(bookings).where(eq(bookings.id, bookingId)))[0] : undefined
  if (!mine || mine.customerId !== userId) return fail(404, { error: 'Not found' })
  const language = (await db.select({ language: users.language }).from(users).where(eq(users.id, userId)))[0]?.language
  const lang = isLang(language) ? language : DEFAULT_LANG
  return db.transaction(async (o) => {
    await lockProviderSlots(o, mine.providerId) // same order as accepting: provider lock, then the row
    const [b] = await o.select().from(bookings).where(eq(bookings.id, bookingId)).for('update')
    if (!b || b.status !== 'awaiting-payment' || !b.payBy || b.payBy <= now) return fail(409, { error: 'not-open' })
    if (b.startAt.getTime() > now.getTime() + MAX_PAY_AHEAD_DAYS * DAY) fail(400, { error: 'TOO_FAR_AHEAD' })
    const stored = readRef(b.checkoutRef)
    if (stored && new Date(stored.expiresAt) > now) return { url: stored.url }
    await assertSlotFree(o, b.providerId, b.startAt, b.durationMin, b.onSite, now, b.id) // a lapsed hold can overlap until the sweep
    const expiresAt = checkoutExpiry(b.payBy, now)
    if (!expiresAt) return fail(409, { error: 'PAY_WINDOW_TOO_SHORT' })
    const done = `${siteBase()}/payment-done${lang === DEFAULT_LANG ? '' : `?lang=${lang}`}` // nothing of the booking in the address
    const session = await gateway().createCheckout({
      bookingId: b.id,
      providerId: b.providerId,
      customerId: b.customerId,
      amountCents: toCents(Number(b.amount)), // the booking's amount, never the client's
      currency: b.currency,
      description: t(lang, 'payment.lineItem', { date: emailDateTime(b.startAt, lang) }),
      successUrl: done,
      cancelUrl: done,
      expiresAt,
      idempotencyKey: `checkout:${b.id}:${expiresAt.toISOString()}:${lang}`,
    })
    const ref: CheckoutRef = { sessionId: session.sessionId, url: session.url, expiresAt: expiresAt.toISOString() }
    await o.update(bookings).set({ checkoutRef: JSON.stringify(ref) }).where(eq(bookings.id, b.id))
    return { url: session.url }
  })
}
