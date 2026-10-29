import type { Booking } from '@kando/contract'

import { bookingActions, bookingStatusText, canPay } from './booking-status'

jest.mock('@/i18n', () => ({ t: (key: string, p?: { date?: string }) => (p?.date ? `${key} ${p.date}` : key) }))
jest.mock('@/lib/booking-time', () => ({ formatWhen: (iso: string) => iso }))

const b = (over: Partial<Booking>) => ({ status: 'proposed', counterBy: null, payBy: null, ...over }) as Booking

test('a new proposal waits for the provider; the customer can only withdraw', () => {
  expect(bookingStatusText(b({}), 'customer')).toBe('bookingStatus.waitProvider')
  expect(bookingActions(b({}), 'customer')).toEqual(['withdraw'])
  expect(bookingStatusText(b({}), 'provider')).toBe('bookingStatus.answerNow')
  expect(bookingActions(b({}), 'provider')).toEqual(['accept', 'decline', 'counter'])
})

test('after the provider countered it is the customer\'s turn, after the customer countered back the provider\'s', () => {
  expect(bookingActions(b({ counterBy: 'provider' }), 'customer')).toEqual(['accept', 'decline', 'counter', 'withdraw'])
  expect(bookingActions(b({ counterBy: 'provider' }), 'provider')).toEqual([])
  expect(bookingStatusText(b({ counterBy: 'provider' }), 'provider')).toBe('bookingStatus.waitCustomer')
  expect(bookingActions(b({ counterBy: 'customer' }), 'provider')).toEqual(['accept', 'decline', 'counter'])
})

test('awaiting payment names the pay-by date for the customer and allows withdrawing', () => {
  const paid = b({ status: 'awaiting-payment', payBy: '2027-01-05' })
  expect(bookingStatusText(paid, 'customer')).toBe('bookingStatus.payBy 2027-01-05')
  expect(bookingStatusText(paid, 'provider')).toBe('bookingStatus.waitPayment 2027-01-05')
  expect(bookingActions(paid, 'customer')).toEqual(['withdraw'])
  expect(bookingActions(paid, 'provider')).toEqual([])
})

test('closed bookings have a status text and no actions', () => {
  for (const status of ['declined', 'expired', 'withdrawn'] as const) {
    expect(bookingStatusText(b({ status }), 'customer')).toBe(`bookingStatus.${status}`)
    expect(bookingActions(b({ status }), 'customer')).toEqual([])
  }
})

test('a confirmed (paid) booking says so for both sides and has no actions here (finishing and cancelling come with plan 2d)', () => {
  for (const viewer of ['customer', 'provider'] as const) {
    expect(bookingStatusText(b({ status: 'confirmed', payBy: '2027-01-05' }), viewer)).toBe('bookingStatus.confirmed')
    expect(bookingActions(b({ status: 'confirmed' }), viewer)).toEqual([])
  }
})

test('Pay now: only the customer, only while awaiting payment and before the pay-by time', () => {
  const now = new Date('2027-01-04T10:00:00Z')
  const open = b({ status: 'awaiting-payment', payBy: '2027-01-05T10:00:00Z' })
  expect(canPay(open, 'customer', now)).toBe(true)
  expect(canPay(open, 'provider', now)).toBe(false)
  expect(canPay(b({ status: 'awaiting-payment', payBy: '2027-01-04T09:00:00Z' }), 'customer', now)).toBe(false)
  expect(canPay(b({ status: 'awaiting-payment', payBy: null }), 'customer', now)).toBe(false)
  expect(canPay(b({ status: 'confirmed', payBy: '2027-01-05T10:00:00Z' }), 'customer', now)).toBe(false)
})
