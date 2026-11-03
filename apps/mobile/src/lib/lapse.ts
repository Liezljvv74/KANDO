import type { QuoteListItem } from '@kando/contract'

import { t, type Key } from '@/i18n'
import { price } from '@/lib/quotes'

/** What lapsed: the banner names the reason (payment time passed, or the time was never agreed) and asks "Do you still want it?". */
export const lapseKey = (reason: NonNullable<QuoteListItem['lapsed']>): Key => (reason === 'payment' ? 'lapse.payment' : 'lapse.time')

/** The customer is asked only about a quote that lapsed and is still valid now (the server checks the same; this keeps a stale list honest). */
export const asksStillWanted = (q: Pick<QuoteListItem, 'role' | 'lapsed' | 'expiresAt' | 'status'>, now = new Date()): boolean =>
  q.role === 'customer' && q.lapsed !== null && q.status === 'sent' && new Date(q.expiresAt) > now

/** What the "I don't need this anymore" dialog says: provider, service and price, so the person knows exactly what is closed. */
export const closeSummary = (q: QuoteListItem): string => t('lapse.closeConfirm', { provider: q.counterparty, service: q.service ?? t('quote.noService'), price: price(q) })

/** The quote the question is about, for a request: the customer's lapsed quote of that request that can still be booked. */
export const lapsedQuoteOf = (list: QuoteListItem[], requestId: string, now = new Date()): QuoteListItem | undefined =>
  list.find((q) => q.requestId === requestId && asksStillWanted(q, now))
