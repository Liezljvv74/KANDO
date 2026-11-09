import type { QuoteListItem } from '@kando/contract'

import { asksStillWanted, closeSummary, lapsedQuoteOf, lapseKey } from './lapse'

// The text is the key followed by its parameters, so the tests see which text and which values were chosen.
jest.mock('@/i18n', () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? [key, ...Object.values(p)].join(' ') : key) }))
jest.mock('@/lib/booking-time', () => ({ formatWhen: (iso: string) => `when:${iso}`, formatDay: (iso: string) => `day:${iso}` }))
jest.mock('@/lib/format', () => ({ formatAmount: (n: number) => `EUR ${n.toFixed(2)}` }))

const now = new Date('2026-11-03T12:00:00.000Z')
const q = (over: Partial<QuoteListItem>): QuoteListItem => ({
  id: 'd1',
  quoteId: 'q1',
  number: 'Q-AB12CD34-2026-0001',
  role: 'customer',
  requestId: 'r1',
  startAt: null,
  durationMin: null,
  amount: 120,
  currency: 'EUR',
  counterparty: 'Ayse Y.',
  service: 'Fence repair',
  scope: 'New posts',
  expiresAt: '2026-11-10T00:00:00.000Z',
  status: 'sent',
  issuedAt: '2026-11-01T10:00:00.000Z',
  pdfReady: true,
  bookingId: null,
  bookedAt: null,
  lapsed: 'payment',
  ...over,
})

test('the banner names the reason: payment time passed, or time not agreed', () => {
  expect(lapseKey('payment')).toBe('lapse.payment')
  expect(lapseKey('time')).toBe('lapse.time')
})

test('the question is asked only of the customer, for a lapsed quote that is still valid', () => {
  expect(asksStillWanted(q({}), now)).toBe(true)
  expect(asksStillWanted(q({ lapsed: 'time' }), now)).toBe(true)
  expect(asksStillWanted(q({ lapsed: null }), now)).toBe(false) // an ordinary open quote: no question
  expect(asksStillWanted(q({ role: 'provider' }), now)).toBe(false)
  expect(asksStillWanted(q({ expiresAt: '2026-11-03T11:59:00.000Z' }), now)).toBe(false) // the quote ran out meanwhile: nothing to book again
  expect(asksStillWanted(q({ status: 'expired' }), now)).toBe(false)
})

test('the close dialog states provider, service and price', () => {
  expect(closeSummary(q({}))).toBe('lapse.closeConfirm Ayse Y. Fence repair EUR 120.00')
  expect(closeSummary(q({ service: null }))).toBe('lapse.closeConfirm Ayse Y. quote.noService EUR 120.00')
})

test('a request finds its own lapsed quote and no other', () => {
  const list = [q({ id: 'a', requestId: 'r2' }), q({ id: 'b', lapsed: null }), q({ id: 'c' })]
  expect(lapsedQuoteOf(list, 'r1', now)?.id).toBe('c')
  expect(lapsedQuoteOf(list, 'r9', now)).toBeUndefined()
})
