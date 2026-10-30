import type { Booking } from '@kando/contract'

import { actionLabel, bookingActions, bookingStatusText, cancelStatement, daysLeft, lateFee, stopAnswerText } from './booking-status'

// The text is the key followed by its parameters, so the tests see which text and which values were chosen.
jest.mock('@/i18n', () => ({ t: (key: string, p?: Record<string, unknown>) => (p ? [key, ...Object.values(p)].join(' ') : key) }))
jest.mock('@/lib/booking-time', () => ({ formatWhen: (iso: string) => iso }))
jest.mock('@/lib/format', () => ({ formatPrice: (s: { price: number }) => `EUR ${s.price.toFixed(2)}` }))

const b = (over: Partial<Booking>) =>
  ({
    status: 'proposed',
    counterBy: null,
    payBy: null,
    parentBookingId: null,
    amount: 100,
    currency: 'EUR',
    startAt: '2027-01-05T09:00:00.000Z',
    noShow: null,
    noShowObjectBy: null,
    askedDoneAt: null,
    confirmBy: null,
    stopStatedAt: null,
    stopAmount: null,
    cancelledBy: null,
    lateCancel: false,
    ...over,
  }) as Booking

const before = new Date('2027-01-04T09:00:00.000Z') // a day before the start
const after = new Date('2027-01-05T11:00:00.000Z') // after the start
const DAY = 86_400_000

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

test('a confirmed (paid) booking: before the start either side may add a task or cancel; nothing else', () => {
  for (const viewer of ['customer', 'provider'] as const) {
    expect(bookingStatusText(b({ status: 'confirmed', payBy: '2027-01-05' }), viewer, before)).toBe('bookingStatus.confirmed')
    expect(bookingActions(b({ status: 'confirmed' }), viewer, before)).toEqual(['additionalTask', 'cancel'])
  }
  // an additional task is itself never extended
  expect(bookingActions(b({ status: 'confirmed', parentBookingId: 'p1' }), 'customer', before)).toEqual(['cancel'])
})

test('after the start: the provider finishes, either side may stop or report a no-show; cancelling is gone', () => {
  expect(bookingActions(b({ status: 'confirmed' }), 'provider', after)).toEqual(['finish', 'additionalTask', 'stop', 'reportNoShow'])
  expect(bookingActions(b({ status: 'confirmed' }), 'customer', after)).toEqual(['additionalTask', 'stop', 'reportNoShow'])
  expect(bookingActions(b({ status: 'confirmed' }), 'provider', new Date('2027-01-05T09:00:00.000Z'))).toContain('finish') // from the start on
})

test('once asked "Was the job done?" the customer can confirm or report a problem', () => {
  const asked = b({ status: 'confirmed', askedDoneAt: '2027-01-06T10:00:00.000Z' })
  expect(bookingActions(asked, 'customer', after)).toEqual(['confirm', 'dispute', 'additionalTask', 'stop', 'reportNoShow'])
  expect(bookingStatusText(asked, 'customer', after)).toBe('bookingStatus.askedDone')
  expect(bookingActions(asked, 'provider', after)).toEqual(['finish', 'additionalTask', 'stop', 'reportNoShow'])
})

test('a reported no-show: only the reported side may object, within its 48 hours', () => {
  const reported = b({ status: 'confirmed', noShow: 'provider', noShowReportedAt: '2027-01-05T10:00:00.000Z', noShowObjectBy: '2027-01-07T10:00:00.000Z' })
  expect(bookingActions(reported, 'provider', after)).toEqual(['objectNoShow'])
  expect(bookingStatusText(reported, 'provider', after)).toBe('bookingStatus.noShowAgainstYou 2027-01-07T10:00:00.000Z')
  expect(bookingActions(reported, 'customer', after)).toEqual([])
  expect(bookingStatusText(reported, 'customer', after)).toBe('bookingStatus.noShowReported 2027-01-07T10:00:00.000Z')
  expect(bookingActions(reported, 'provider', new Date('2027-01-07T10:00:00.000Z'))).toEqual([])
})

test('finished: the customer sees the payment date and can confirm or report a problem until then; afterwards the payment is pending', () => {
  const finished = b({ status: 'finished', confirmBy: '2027-01-12T11:00:00.000Z' })
  expect(bookingStatusText(finished, 'customer', after)).toBe('bookingStatus.finishedCustomer 2027-01-12T11:00:00.000Z')
  expect(bookingStatusText(finished, 'provider', after)).toBe('bookingStatus.finishedProvider 2027-01-12T11:00:00.000Z')
  expect(bookingActions(finished, 'customer', after)).toEqual(['confirm', 'dispute', 'additionalTask'])
  expect(bookingActions(finished, 'provider', after)).toEqual(['additionalTask'])
  const due = new Date('2027-01-12T11:00:00.000Z')
  for (const viewer of ['customer', 'provider'] as const) expect(bookingStatusText(finished, viewer, due)).toBe('bookingStatus.paymentPending')
  expect(bookingActions(finished, 'customer', due)).toEqual(['additionalTask'])
})

test('the 7-day countdown counts whole days left, never below 0', () => {
  const now = new Date('2027-01-05T11:00:00.000Z')
  expect(daysLeft('2027-01-12T11:00:00.000Z', now)).toBe(7)
  expect(daysLeft(new Date(now.getTime() + DAY + 1).toISOString(), now)).toBe(2)
  expect(daysLeft(new Date(now.getTime() + 1).toISOString(), now)).toBe(1)
  expect(daysLeft('2027-01-01T00:00:00.000Z', now)).toBe(0)
})

test('stopped: the provider states the amount, then the customer answers; agreed means the payment is being made', () => {
  const stopped = b({ status: 'stopped', stoppedBy: 'customer' })
  expect(bookingActions(stopped, 'provider', after)).toEqual(['stateStopAmount'])
  expect(bookingActions(stopped, 'customer', after)).toEqual([])
  expect(bookingStatusText(stopped, 'customer', after)).toBe('bookingStatus.stoppedWaitAmount')
  expect(bookingStatusText(stopped, 'provider', after)).toBe('bookingStatus.stoppedStateAmount')
  const stated = b({ status: 'stopped', stopAmount: 40, stopStatedAt: '2027-01-05T12:00:00.000Z' })
  expect(bookingActions(stated, 'customer', after)).toEqual(['answerStop'])
  expect(bookingActions(stated, 'provider', after)).toEqual([])
  expect(bookingStatusText(stated, 'customer', after)).toBe('bookingStatus.stopAnswerBy EUR 40.00 2027-01-12T12:00:00.000Z')
  expect(bookingStatusText(stated, 'provider', after)).toBe('bookingStatus.stopWaitAnswer EUR 40.00')
  const agreed = { ...stated, confirmBy: '2027-01-05T13:00:00.000Z' }
  for (const viewer of ['customer', 'provider'] as const) {
    expect(bookingActions(agreed, viewer, after)).toEqual([])
    expect(bookingStatusText(agreed, viewer, after)).toBe('bookingStatus.paymentPending')
  }
})

test('the stop answer says what goes to the provider and what comes back, from the stated amount in whole cents', () => {
  expect(stopAnswerText(b({ status: 'stopped', amount: 100, stopAmount: 40 }))).toBe('booking.stopAnswerText EUR 40.00 EUR 60.00')
  expect(stopAnswerText(b({ status: 'stopped', amount: 0.3, stopAmount: 0.1 }))).toBe('booking.stopAnswerText EUR 0.10 EUR 0.20')
})

test('cancel: free until 24 hours before the start, then half (half-up cents, as the server); a provider cancellation refunds fully', () => {
  const start = new Date('2027-01-05T09:00:00.000Z').getTime()
  const at24 = new Date(start - DAY)
  const late = new Date(start - DAY + 1)
  expect(cancelStatement(b({ status: 'confirmed' }), 'customer', at24)).toBe('booking.cancelFree')
  expect(cancelStatement(b({ status: 'confirmed' }), 'customer', late)).toBe('booking.cancelLate 50 EUR 50.00 EUR 50.00')
  expect(cancelStatement(b({ status: 'confirmed', amount: 33.33 }), 'customer', late)).toBe('booking.cancelLate 50 EUR 16.67 EUR 16.66')
  expect(cancelStatement(b({ status: 'confirmed', amount: 0.01 }), 'customer', late)).toBe('booking.cancelLate 50 EUR 0.01 EUR 0.00')
  expect(cancelStatement(b({ status: 'confirmed' }), 'provider', at24)).toBe('booking.cancelByProvider')
  expect(cancelStatement(b({ status: 'confirmed' }), 'provider', late)).toBe('booking.cancelByProviderLate')
  expect(lateFee(33.33)).toBe(16.67)
  expect(lateFee(0.03)).toBe(0.02) // 1.5 cents rounds half up, as the server's Math.round
})

test('the endings say in plain words what happened, for each side', () => {
  const cases: [Partial<Booking>, string, string][] = [
    [{ cancelledBy: 'customer', lateCancel: false }, 'bookingStatus.cancelledByYou', 'bookingStatus.cancelledByCustomer'],
    [{ cancelledBy: 'customer', lateCancel: true }, 'bookingStatus.cancelledByYouLate', 'bookingStatus.cancelledByCustomerLate'],
    [{ cancelledBy: 'provider' }, 'bookingStatus.cancelledByProvider', 'bookingStatus.cancelledByYouProvider'],
    [{ noShow: 'customer' }, 'bookingStatus.noShowEndedYou', 'bookingStatus.noShowEndedCustomer'],
    [{ noShow: 'provider' }, 'bookingStatus.noShowEndedProvider', 'bookingStatus.noShowEndedYouProvider'],
    [{}, 'bookingStatus.cancelled', 'bookingStatus.cancelled'],
  ]
  for (const [over, customer, provider] of cases) {
    expect(bookingStatusText(b({ status: 'cancelled', ...over }), 'customer', after)).toBe(customer)
    expect(bookingStatusText(b({ status: 'cancelled', ...over }), 'provider', after)).toBe(provider)
  }
  for (const status of ['completed', 'disputed', 'refunded'] as const)
    for (const viewer of ['customer', 'provider'] as const) {
      expect(bookingStatusText(b({ status }), viewer, after)).toBe(`bookingStatus.${status}`)
      expect(bookingActions(b({ status }), viewer, after)).toEqual([])
    }
})

test('the customer asks for an "Additional task", the provider for a "Scope/quote review"', () => {
  expect(actionLabel('additionalTask', 'customer')).toBe('booking.additionalTask')
  expect(actionLabel('additionalTask', 'provider')).toBe('booking.scopeReview')
  expect(actionLabel('finish', 'provider')).toBe('booking.finish')
})
