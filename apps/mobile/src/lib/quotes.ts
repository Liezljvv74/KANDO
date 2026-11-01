import type { QuoteListItem } from '@kando/contract'

import { t, type Key } from '@/i18n'
import { formatDay, formatWhen } from '@/lib/booking-time'
import { formatPrice } from '@/lib/format'

/** "My received quotes" (the person as customer) and "Quotes sent" (as provider), in the order the server sent them (newest first). */
export function splitQuotes(list: QuoteListItem[]): { received: QuoteListItem[]; sent: QuoteListItem[] } {
  return { received: list.filter((q) => q.role === 'customer'), sent: list.filter((q) => q.role === 'provider') }
}

/** The lines under a quote's number: who, the time (or that it is still to be confirmed), the date, the total and the state. */
export function quoteLines(q: QuoteListItem): string[] {
  const total = formatPrice({ priceType: 'fixed', price: q.amount, currency: q.currency })
  return [
    t(q.role === 'customer' ? 'invoice.from' : 'invoice.to', { name: q.counterparty }),
    q.startAt ? t('booking.quoteSuggested', { when: formatWhen(q.startAt) }) : t('booking.quoteTimeOpen'),
    `${formatDay(q.issuedAt)} · ${total} · ${t(`quoteStatus.${q.status}` as Key)}`,
  ]
}
