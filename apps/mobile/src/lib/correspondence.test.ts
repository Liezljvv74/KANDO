import type { Notification } from '@kando/contract'

import { categoryOf, unseenCounts } from './correspondence'

const n = (kind: string, over: Partial<Notification> = {}) => ({ id: kind, kind, payload: { bookingId: 'b', quoteId: 'q' }, createdAt: 'x', seenAt: null, dismissedAt: null, ...over }) as Notification

describe('correspondence', () => {
  it('sorts notifications into the three lists', () => {
    expect(categoryOf(n('message-received', { payload: { url: 'https://x.test/t', threadId: 't' } }))).toBe('messages')
    expect(categoryOf(n('quote-received'))).toBe('quotes')
    expect(categoryOf(n('booking-accepted'))).toBe('bookings')
    expect(categoryOf(n('profile-live', { payload: { url: 'https://x.test/p' } }))).toBeNull()
  })
  it('counts only what is unseen and not dismissed', () => {
    const list = [n('quote-received'), n('booking-accepted'), n('booking-paid', { seenAt: 'now' }), n('quote-expiring', { dismissedAt: 'now' })]
    expect(unseenCounts(list)).toEqual({ bookings: 1, quotes: 1, messages: 0, total: 2 })
  })
})
