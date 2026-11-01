import type { QuoteListItem } from '@kando/contract'

import { quoteLines, splitQuotes } from './quotes'

// The text is the key followed by its parameters, so the tests see which text and which values were chosen.
jest.mock('@/i18n', () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? [key, ...Object.values(p)].join(' ') : key) }))
jest.mock('@/lib/booking-time', () => ({ formatWhen: (iso: string) => `when:${iso}`, formatDay: (iso: string) => `day:${iso}` }))
jest.mock('@/lib/format', () => ({ formatPrice: (s: { price: number }) => `EUR ${s.price.toFixed(2)}` }))

const q = (over: Partial<QuoteListItem>): QuoteListItem => ({
  id: 'd1',
  quoteId: 'q1',
  number: 'Q-AB12CD34-2026-0001',
  role: 'customer',
  requestId: 'r1',
  startAt: '2027-01-05T09:00:00.000Z',
  durationMin: 60,
  amount: 120,
  currency: 'EUR',
  counterparty: 'Ayse Y.',
  status: 'sent',
  issuedAt: '2026-11-01T10:00:00.000Z',
  pdfReady: true,
  ...over,
})

test('the list splits into received quotes and sent quotes and keeps the server order', () => {
  const list = [q({ id: 'a', role: 'provider' }), q({ id: 'b' }), q({ id: 'c', role: 'provider' }), q({ id: 'd' })]
  const { received, sent } = splitQuotes(list)
  expect(received.map((x) => x.id)).toEqual(['b', 'd'])
  expect(sent.map((x) => x.id)).toEqual(['a', 'c'])
})

test('a received quote says from whom, a sent quote to whom; the time, date, total and state follow', () => {
  expect(quoteLines(q({}))).toEqual(['invoice.from Ayse Y.', 'booking.quoteSuggested when:2027-01-05T09:00:00.000Z', 'day:2026-11-01T10:00:00.000Z · EUR 120.00 · quoteStatus.sent'])
  expect(quoteLines(q({ role: 'provider', status: 'superseded' }))[0]).toBe('invoice.to Ayse Y.')
  expect(quoteLines(q({ role: 'provider', status: 'superseded' }))[2]).toContain('quoteStatus.superseded')
})

test('a quote without a time says it is still to be confirmed', () => {
  expect(quoteLines(q({ startAt: null, durationMin: null }))[1]).toBe('booking.quoteTimeOpen')
})
