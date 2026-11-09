import type { Notification } from '@kando/contract'

import { categoryOf, isJobPageNotice } from './job-notices'

const n = (kind: string, over: Partial<Notification> = {}) => ({ id: kind, kind, payload: { bookingId: 'b', quoteId: 'q' }, createdAt: 'x', seenAt: null, dismissedAt: null, ...over }) as Notification

describe('job notices', () => {
  it('sorts notifications into the three lists', () => {
    expect(categoryOf(n('message-received', { payload: { url: 'https://x.test/t', threadId: 't' } }))).toBe('messages')
    expect(categoryOf(n('quote-received'))).toBe('quotes')
    expect(categoryOf(n('booking-accepted'))).toBe('bookings')
    expect(categoryOf(n('profile-live', { payload: { url: 'https://x.test/p' } }))).toBeNull()
  })

  it('finds the quote and booking notices a job page shows, and nothing else', () => {
    const job = { id: 'root', number: 1, title: 'T', otherParty: 'O', requestId: 'r1' }
    const page = (x: Notification) => isJobPageNotice(x, 'r1', ['b1', 'b2'])
    expect(page(n('quote-received', { payload: { requestId: 'r1', quoteId: 'q' } }))).toBe(true) // names the request
    expect(page(n('booking-paid', { payload: { bookingId: 'b2' } }))).toBe(true) // names one of its bookings
    expect(page(n('booking-paid', { payload: { bookingId: 'bX' }, job }))).toBe(true) // opens this page
    expect(page(n('booking-paid', { payload: { bookingId: 'bX' } }))).toBe(false) // another job's booking
    expect(page(n('quote-received', { payload: { requestId: 'r2', quoteId: 'q' } }))).toBe(false) // another request
    expect(page(n('message-received', { payload: { url: 'https://x.test/t', threadId: 't' }, job }))).toBe(false) // the chat marks its own
    expect(page(n('profile-live', { payload: { url: 'https://x.test/p' } }))).toBe(false)
  })
})
