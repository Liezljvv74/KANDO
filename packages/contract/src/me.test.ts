import { expect, it } from 'vitest'

import { MeSchema } from './me'

const me = { id: 'u', email: 'a@b.c', firstName: null, lastName: null, isProvider: false, photoUrl: null, address: null }
const n = (id: string, kind: string, payload: object) => ({ id, kind, payload, createdAt: 'x', seenAt: null, dismissedAt: null })

it('an old kind and a new kind parse; an unknown kind is dropped without failing the rest', () => {
  const parsed = MeSchema.parse({
    ...me,
    notifications: [n('1', 'profile-live', { url: 'https://x.test/p' }), n('2', 'quote-received', { quoteId: 'q' }), n('3', 'kind-from-the-future', { whatever: 1 }), n('4', 'requests-ignored', {})],
  })
  expect(parsed.notifications.map((x) => x.id)).toEqual(['1', '2', '4'])
})

it('a message-received notification with url and threadId parses, and profile-live with just a url still does', () => {
  const r = MeSchema.parse({ ...me, notifications: [n('1', 'message-received', { url: 'skilled://threads/t1', threadId: 't1' }), n('2', 'profile-live', { url: 'https://x.test/p' })] })
  expect(r.notifications.map((x) => [x.kind, x.payload])).toEqual([
    ['message-received', { url: 'skilled://threads/t1', threadId: 't1' }],
    ['profile-live', { url: 'https://x.test/p' }],
  ])
})

it('the payment kinds parse', () => {
  const kinds = ['booking-paid', 'payment-received', 'payment-late-refunded', 'payout-setup-complete', 'customers-waiting', 'provider-available', 'refund-issued']
  const r = MeSchema.parse({ ...me, notifications: kinds.map((k, i) => n(String(i), k, { bookingId: 'b' })) })
  expect(r.notifications.map((x) => x.kind)).toEqual(kinds)
})

it('a customers-waiting notice carries only the count', () => {
  const r = MeSchema.parse({ ...me, notifications: [n('1', 'customers-waiting', { count: 3 })] })
  expect(r.notifications[0]!.payload).toEqual({ count: 3 })
})
