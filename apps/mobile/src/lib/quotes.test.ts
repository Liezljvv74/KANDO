import type { QuoteListItem } from '@kando/contract'

import { acceptedRows, acceptSummary, openQuotes, otherQuotes, quoteLines, shownStatus, splitQuotes } from './quotes'

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
  service: 'Fence repair',
  scope: 'New posts and panels',
  expiresAt: '2099-01-01T00:00:00.000Z',
  status: 'sent',
  issuedAt: '2026-11-01T10:00:00.000Z',
  pdfReady: true,
  bookingId: null,
  bookedAt: null,
  lapsed: null,
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

const now = new Date('2026-11-03T12:00:00.000Z')

test('an open quote past its last valid day reads expired and is no longer an offer', () => {
  const late = q({ id: 'late', expiresAt: '2026-11-03T11:59:00.000Z' })
  expect(shownStatus(late, now)).toBe('expired')
  expect(shownStatus(q({ status: 'declined', expiresAt: '2026-11-03T11:59:00.000Z' }), now)).toBe('declined')
  expect(quoteLines(late, now)[2]).toContain('quoteStatus.expired')
  expect(openQuotes([late], now)).toEqual([])
})

test('every open received quote is its own offer; the others stay documents', () => {
  const list = [
    q({ id: 'a' }),
    q({ id: 'b', status: 'accepted', bookingId: 'bk1', bookedAt: '2026-11-02T10:00:00.000Z' }),
    q({ id: 'c' }),
    q({ id: 'd', status: 'superseded' }),
    q({ id: 'e', status: 'declined' }),
    q({ id: 'f', expiresAt: '2026-11-01T00:00:00.000Z' }),
    q({ id: 'g', role: 'provider' }),
  ]
  const { received } = splitQuotes(list)
  expect(openQuotes(received, now).map((x) => x.id)).toEqual(['a', 'c'])
  expect(otherQuotes(received, now).map((x) => x.id)).toEqual(['b', 'd', 'e', 'f'])
})

test('the accept question names provider, service, price and time exactly', () => {
  expect(acceptSummary(q({}))).toBe('quote.acceptSummary Q-AB12CD34-2026-0001 Ayse Y. Fence repair EUR 120.00 when:2027-01-05T09:00:00.000Z')
  expect(acceptSummary(q({ startAt: null, service: null }))).toBe('quote.acceptSummary Q-AB12CD34-2026-0001 Ayse Y. quote.noService EUR 120.00 booking.quoteTimeOpen')
})

test('the accepted table has provider, date accepted, service and price, newest first, and needs a booking', () => {
  const list = [
    q({ id: 'old', status: 'accepted', bookingId: 'b1', bookedAt: '2026-10-30T08:00:00.000Z', counterparty: 'Anna H.', amount: 80 }),
    q({ id: 'new', status: 'accepted', bookingId: 'b2', bookedAt: '2026-11-02T08:00:00.000Z', service: null }),
    q({ id: 'open' }),
    q({ id: 'nobooking', status: 'accepted' }),
    q({ id: 'mine', role: 'provider', status: 'accepted', bookingId: 'b3', bookedAt: '2026-11-02T09:00:00.000Z' }),
  ]
  expect(acceptedRows(list)).toEqual([
    { id: 'new', number: 'Q-AB12CD34-2026-0001', bookingId: 'b2', provider: 'Ayse Y.', bookedAt: '2026-11-02T08:00:00.000Z', service: null, price: 'EUR 120.00' },
    { id: 'old', number: 'Q-AB12CD34-2026-0001', bookingId: 'b1', provider: 'Anna H.', bookedAt: '2026-10-30T08:00:00.000Z', service: 'Fence repair', price: 'EUR 80.00' },
  ])
})
