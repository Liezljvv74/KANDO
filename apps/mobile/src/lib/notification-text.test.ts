import { NOTIFICATION_KINDS } from '@kando/contract'

import { isBookingNotice, notificationTarget, notificationThreadId } from './notification-text'

test('only a message-received notice opens a thread: by its threadId, else by the link', () => {
  expect(notificationThreadId({ kind: 'message-received', payload: { url: 'skilled://threads/x', threadId: 't1' } })).toBe('t1')
  expect(notificationThreadId({ kind: 'message-received', payload: { url: 'skilled://threads/t2' } })).toBe('t2')
  expect(notificationThreadId({ kind: 'message-received', payload: { url: 'https://evil.test/threads/t3' } })).toBeNull()
  expect(notificationThreadId({ kind: 'profile-live', payload: { url: 'skilled://threads/t1', threadId: 't1' } })).toBeNull()
  expect(notificationThreadId({ kind: 'quote-received', payload: { bookingId: 'b' } })).toBeNull()
})

test('where a notice leads: provider-available to the provider page, customers-waiting to the payout card, the rest nowhere', () => {
  const at = (kind: 'provider-available' | 'customers-waiting' | 'payout-setup-complete', payload: object) => notificationTarget({ kind, payload } as never)
  expect(at('provider-available', { url: 'https://skillweb.space/providers/anna-b?lang=en' })).toEqual({ path: '/provider/anna-b' })
  expect(at('provider-available', { url: 'https://skillweb.space/other' })).toBeNull()
  expect(at('provider-available', {})).toBeNull()
  expect(at('customers-waiting', { count: 2 })).toEqual({ path: '/my-profile' })
  expect(at('payout-setup-complete', {})).toEqual({ path: '/my-profile' })
  expect(notificationTarget({ kind: 'commission-invoice-ready', payload: { url: 'skilled://invoices/commission' } })).toEqual({ path: '/invoices/commission' })
})

const at = (kind: string, payload: object) => notificationTarget({ kind, payload } as never)
const NOT_BOOKING = ['profile-live', 'message-received', 'provider-available', 'customers-waiting', 'payout-setup-complete', 'commission-invoice-ready']

test('every booking kind with a bookingId opens the booking', () => {
  for (const kind of NOTIFICATION_KINDS.filter((k) => !NOT_BOOKING.includes(k))) expect([kind, at(kind, { bookingId: 'b-1' })]).toEqual([kind, { path: '/bookings/b-1' }])
})

test('a requestId alone opens the request', () => {
  expect(at('request-received', { requestId: 'r-1' })).toEqual({ path: '/bookings/request/r-1' })
  expect(at('request-withdrawn', { requestId: 'r-1' })).toEqual({ path: '/bookings/request/r-1' })
  expect(at('request-declined', { requestId: 'r-1' })).toEqual({ path: '/bookings/request/r-1' })
})

test('request-withdrawn and request-declined also open the request when both ids are named (same list as the server push)', () => {
  expect(at('request-withdrawn', { requestId: 'r-1', bookingId: 'b-1' })).toEqual({ path: '/bookings/request/r-1' })
  expect(at('request-declined', { requestId: 'r-1', bookingId: 'b-1' })).toEqual({ path: '/bookings/request/r-1' })
})

test('request-reopened opens the request, not the ended booking', () => {
  expect(at('request-reopened', { requestId: 'r-1', bookingId: 'b-1' })).toEqual({ path: '/bookings/request/r-1' })
})

test('requests-ignored opens the list', () => {
  expect(at('requests-ignored', {})).toEqual({ path: '/bookings' })
  expect(at('provider-warning', {})).toEqual({ path: '/bookings' })
})

test('a malformed id gives no target', () => {
  expect(at('quote-received', { bookingId: '../x' })).toBeNull()
  expect(at('quote-received', { requestId: 'x'.repeat(101) })).toBeNull()
})

test('isBookingNotice is false for profile-live and message-received', () => {
  const is = (kind: string, payload: object) => isBookingNotice({ kind, payload } as never)
  expect(is('profile-live', { url: 'https://x.test/p' })).toBe(false)
  expect(is('message-received', { url: 'skilled://threads/t1', threadId: 't1' })).toBe(false)
  expect(is('quote-received', { bookingId: 'b-1' })).toBe(true)
  expect(is('requests-ignored', {})).toBe(true)
})

test('a notice with a job names it in the text and opens the job page; without a job the old target stays', () => {
  const job = { id: 'req-1', number: 1040, title: 'Photo session', otherParty: 'Anna H.' }
  // the server names the page (job.requestId): every job kind opens the job page, a booking's scrolled to that booking
  const onPage = { ...job, requestId: 'req-1' }
  for (const kind of NOTIFICATION_KINDS.filter((k) => !['customers-waiting', 'payout-setup-complete', 'commission-invoice-ready', 'profile-live', 'message-received', 'provider-available', 'provider-warning'].includes(k))) {
    expect(notificationTarget({ kind, payload: { requestId: 'req-1' }, job: onPage })).toEqual({ path: '/bookings/request/req-1' })
    expect(notificationTarget({ kind, payload: { bookingId: 'b-1' }, job: onPage })).toEqual({ path: '/bookings/request/req-1?booking=b-1' })
  }
  // an additional task: the job is the ROOT request, the page is the task's own request
  expect(notificationTarget({ kind: 'payment-reminder', payload: { bookingId: 'b-2' }, job: { ...job, requestId: 'child-1' } })).toEqual({ path: '/bookings/request/child-1?booking=b-2' })
  // kinds without a job keep their target; a provider warning keeps the booking link; a malformed id opens nothing
  expect(notificationTarget({ kind: 'provider-warning', payload: { bookingId: 'b-1' }, job: onPage })).toEqual({ path: '/bookings/b-1' })
  expect(notificationTarget({ kind: 'requests-ignored', payload: {}, job: null })).toEqual({ path: '/bookings' })
  expect(notificationTarget({ kind: 'booking-paid', payload: { bookingId: 'b 1' }, job: onPage })).toBeNull()
  // an older server (a job without requestId, or no job): the old booking or request link, which lands on the same job page
  expect(notificationTarget({ kind: 'booking-paid', payload: { bookingId: 'b-1' }, job })).toEqual({ path: '/bookings/b-1' })
  expect(notificationTarget({ kind: 'quote-received', payload: { requestId: 'child-1' }, job })).toEqual({ path: '/bookings/request/child-1' })
  expect(notificationTarget({ kind: 'booking-paid', payload: { bookingId: 'b-1' } })).toEqual({ path: '/bookings/b-1' })
  expect(notificationTarget({ kind: 'booking-paid', payload: { bookingId: 'b-1' }, job: null })).toEqual({ path: '/bookings/b-1' })
  expect(notificationTarget({ kind: 'customers-waiting', payload: {}, job })).toEqual({ path: '/my-profile' })
})
