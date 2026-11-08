import type { Notification } from '@kando/contract'

import { categoryOf } from './correspondence'

const n = (kind: string, over: Partial<Notification> = {}) => ({ id: kind, kind, payload: { bookingId: 'b', quoteId: 'q' }, createdAt: 'x', seenAt: null, dismissedAt: null, ...over }) as Notification

describe('correspondence', () => {
  it('sorts notifications into the three lists', () => {
    expect(categoryOf(n('message-received', { payload: { url: 'https://x.test/t', threadId: 't' } }))).toBe('messages')
    expect(categoryOf(n('quote-received'))).toBe('quotes')
    expect(categoryOf(n('booking-accepted'))).toBe('bookings')
    expect(categoryOf(n('profile-live', { payload: { url: 'https://x.test/p' } }))).toBeNull()
  })
})
