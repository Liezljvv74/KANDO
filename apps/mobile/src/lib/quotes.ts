import type { QuoteListItem } from '@kando/contract'

import { t, type Key } from '@/i18n'
import { formatDay, formatWhen } from '@/lib/booking-time'
import { formatPrice } from '@/lib/format'

export const price = (q: Pick<QuoteListItem, 'amount' | 'currency'>) => formatPrice({ priceType: 'fixed', price: q.amount, currency: q.currency })

/** "My received quotes" (the person as customer) and "Quotes sent" (as provider), in the order the server sent them (newest first). */
export function splitQuotes(list: QuoteListItem[]): { received: QuoteListItem[]; sent: QuoteListItem[] } {
  return { received: list.filter((q) => q.role === 'customer'), sent: list.filter((q) => q.role === 'provider') }
}

/** A quote still open past its last valid day reads expired (the daily timer writes it later). */
export const shownStatus = (q: Pick<QuoteListItem, 'status' | 'expiresAt'>, now = new Date()): QuoteListItem['status'] =>
  q.status === 'sent' && new Date(q.expiresAt) <= now ? 'expired' : q.status

/** The quotes the customer can accept now: received, open and not expired, each with its own Accept button. */
const isOpen = (q: QuoteListItem, now: Date): boolean => q.role === 'customer' && shownStatus(q, now) === 'sent'
export const openQuotes = (received: QuoteListItem[], now = new Date()): QuoteListItem[] => received.filter((q) => isOpen(q, now))

/** The received quotes that are not an open offer (accepted, expired, declined, replaced): they stay as document rows with their PDF. */
export const otherQuotes = (received: QuoteListItem[], now = new Date()): QuoteListItem[] => received.filter((q) => !isOpen(q, now))

export type AcceptedRow = { id: string; number: string; bookingId: string; provider: string; bookedAt: string; service: string | null; price: string }

/** The table of accepted quotes: provider, date accepted (when the booking was made), service, price; newest first. A row opens the booking. */
export function acceptedRows(received: QuoteListItem[]): AcceptedRow[] {
  return received
    .flatMap((q) => (q.role === 'customer' && q.status === 'accepted' && q.bookingId && q.bookedAt ? [{ id: q.id, number: q.number, bookingId: q.bookingId, provider: q.counterparty, bookedAt: q.bookedAt, service: q.service, price: price(q) }] : []))
    .sort((a, b) => new Date(b.bookedAt).getTime() - new Date(a.bookedAt).getTime())
}

/** The time a quote offers, or that it is still to be agreed. */
export const quoteWhen = (q: Pick<QuoteListItem, 'startAt'>): string => (q.startAt ? formatWhen(q.startAt) : t('booking.quoteTimeOpen'))

/** What the confirmation says before accepting: provider, service, price and time, exactly. */
export const acceptSummary = (q: QuoteListItem): string => t('quote.acceptSummary', { number: q.number, provider: q.counterparty, service: q.service ?? t('quote.noService'), price: price(q), when: quoteWhen(q) })

/** The lines under a quote's number: who, the time (or that it is still to be confirmed), the date, the total and the state. */
export function quoteLines(q: QuoteListItem, now = new Date()): string[] {
  return [
    t(q.role === 'customer' ? 'invoice.from' : 'invoice.to', { name: q.counterparty }),
    q.startAt ? t('booking.quoteSuggested', { when: formatWhen(q.startAt) }) : t('booking.quoteTimeOpen'),
    `${formatDay(q.issuedAt)} · ${price(q)} · ${t(`quoteStatus.${shownStatus(q, now)}` as Key)}`,
  ]
}
