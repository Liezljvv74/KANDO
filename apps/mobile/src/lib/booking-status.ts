import type { Booking } from '@kando/contract'

import { t, type Key } from '@/i18n'
import { formatWhen } from '@/lib/booking-time'

export type Viewer = 'customer' | 'provider'
export type BookingAction = 'accept' | 'decline' | 'counter' | 'withdraw'

/** Whose answer a proposal waits for: the customer made the first proposal (counterBy null), so the provider answers it. The server enforces this; the app only chooses what to show. */
export const waitingFor = (b: Pick<Booking, 'counterBy'>): Viewer => (b.counterBy === 'provider' ? 'customer' : 'provider')

/** The status in plain words for the viewer. */
export function bookingStatusText(b: Booking, viewer: Viewer): string {
  if (b.status === 'proposed') return t(waitingFor(b) === viewer ? 'bookingStatus.answerNow' : viewer === 'customer' ? 'bookingStatus.waitProvider' : 'bookingStatus.waitCustomer')
  if (b.status === 'awaiting-payment') {
    const key: Key = viewer === 'customer' ? 'bookingStatus.payBy' : 'bookingStatus.waitPayment'
    return t(key, { date: b.payBy ? formatWhen(b.payBy) : '' })
  }
  return t(`bookingStatus.${b.status}` as Key)
}

/** The buttons to offer now. */
export function bookingActions(b: Booking, viewer: Viewer): BookingAction[] {
  const withdraw: BookingAction[] = viewer === 'customer' ? ['withdraw'] : []
  if (b.status === 'proposed') return waitingFor(b) === viewer ? ['accept', 'decline', 'counter', ...withdraw] : withdraw
  return b.status === 'awaiting-payment' ? withdraw : []
}
