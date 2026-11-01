import { DAY, FREE_CANCEL_HOURS, HOUR, LATE_CANCEL_SHARE, STOP_ANSWER_DAYS, type Booking } from '@kando/contract'

import { t, type Key } from '@/i18n'
import { formatWhen } from '@/lib/booking-time'
import { formatPrice } from '@/lib/format'

export type Viewer = 'customer' | 'provider'
export type BookingAction =
  | 'accept'
  | 'decline'
  | 'counter'
  | 'withdraw'
  | 'enterTime'
  | 'confirmTime'
  | 'finish'
  | 'confirm'
  | 'dispute'
  | 'additionalTask'
  | 'cancel'
  | 'stop'
  | 'reportNoShow'
  | 'objectNoShow'
  | 'stateStopAmount'
  | 'answerStop'

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN)
const money = (b: Pick<Booking, 'currency'>, cents: number) => formatPrice({ priceType: 'fixed', price: cents / 100, currency: b.currency })
const cents = (x: number) => Math.round(x * 100)

/** Whose answer a proposal waits for: the customer made the first proposal (counterBy null), so the provider answers it. The server enforces this; the app only chooses what to show. */
export const waitingFor = (b: Pick<Booking, 'counterBy'>): Viewer => (b.counterBy === 'provider' ? 'customer' : 'provider')

/** Whole days left until `iso` (a started day counts), never below 0: the confirmation countdown. */
export const daysLeft = (iso: string, now = new Date()): number => Math.max(0, Math.ceil((ms(iso) - now.getTime()) / DAY))

/** What a late customer cancellation costs: half the price in whole cents, half up (the server's Math.round). */
export const lateFee = (amount: number): number => Math.round(cents(amount) * LATE_CANCEL_SHARE) / 100

/** The status in plain words for the viewer. */
export function bookingStatusText(b: Booking, viewer: Viewer, now = new Date()): string {
  const date = (iso: string | null) => (iso ? formatWhen(iso) : '')
  switch (b.status) {
    case 'proposed':
      return t(waitingFor(b) === viewer ? 'bookingStatus.answerNow' : viewer === 'customer' ? 'bookingStatus.waitProvider' : 'bookingStatus.waitCustomer')
    case 'awaiting-payment':
      return t(viewer === 'customer' ? 'bookingStatus.payBy' : 'bookingStatus.waitPayment', { date: date(b.payBy) })
    case 'confirmed':
      if (b.noShow) return t(b.noShow === viewer ? 'bookingStatus.noShowAgainstYou' : 'bookingStatus.noShowReported', { date: date(b.noShowObjectBy) })
      return t(b.askedDoneAt && viewer === 'customer' ? 'bookingStatus.askedDone' : 'bookingStatus.confirmed')
    case 'finished':
      if (!b.confirmBy || ms(b.confirmBy) <= now.getTime()) return t('bookingStatus.paymentPending')
      return t(viewer === 'customer' ? 'bookingStatus.finishedCustomer' : 'bookingStatus.finishedProvider', { date: date(b.confirmBy) })
    case 'stopped':
      if (b.confirmBy) return t('bookingStatus.paymentPending') // the customer agreed: the payment is being made
      if (b.stopAmount === null || !b.stopStatedAt) return t(viewer === 'provider' ? 'bookingStatus.stoppedStateAmount' : 'bookingStatus.stoppedWaitAmount')
      if (viewer === 'provider') return t('bookingStatus.stopWaitAnswer', { amount: money(b, cents(b.stopAmount)) })
      return t('bookingStatus.stopAnswerBy', { amount: money(b, cents(b.stopAmount)), date: formatWhen(new Date(ms(b.stopStatedAt) + STOP_ANSWER_DAYS * DAY).toISOString()) })
    case 'cancelled':
      return t(cancelledKey(b, viewer))
    default:
      return t(`bookingStatus.${b.status}` as Key)
  }
}

function cancelledKey(b: Booking, viewer: Viewer): Key {
  const you = viewer === 'customer'
  if (b.noShow === 'customer') return you ? 'bookingStatus.noShowEndedYou' : 'bookingStatus.noShowEndedCustomer'
  if (b.noShow === 'provider') return you ? 'bookingStatus.noShowEndedProvider' : 'bookingStatus.noShowEndedYouProvider'
  if (b.cancelledBy === 'provider') return you ? 'bookingStatus.cancelledByProvider' : 'bookingStatus.cancelledByYouProvider'
  if (b.cancelledBy === 'customer')
    return b.lateCancel ? (you ? 'bookingStatus.cancelledByYouLate' : 'bookingStatus.cancelledByCustomerLate') : you ? 'bookingStatus.cancelledByYou' : 'bookingStatus.cancelledByCustomer'
  return 'bookingStatus.cancelled' // ended by our team
}

/** The buttons to offer now. The server re-checks every one; a button shown a moment too long gets its plain error text. */
export function bookingActions(b: Booking, viewer: Viewer, now = new Date()): BookingAction[] {
  const customer = viewer === 'customer'
  const withdraw: BookingAction[] = customer ? ['withdraw'] : []
  const extra: BookingAction[] = b.parentBookingId === null && !b.noShow ? ['additionalTask'] : []
  switch (b.status) {
    case 'proposed':
      return waitingFor(b) === viewer ? ['accept', 'decline', 'counter', ...withdraw] : withdraw
    case 'awaiting-time': {
      // either side enters the agreed time; the other confirms it (never your own entry). Only the customer can walk away: the provider uses the chat or lets it lapse.
      const theirs = !!b.pendingTime && b.pendingTime.by !== viewer
      return [...(theirs ? ['confirmTime' as const] : []), 'enterTime', ...withdraw]
    }
    case 'awaiting-payment':
      return withdraw
    case 'confirmed': {
      if (b.noShow) return b.noShow === viewer && now.getTime() < ms(b.noShowObjectBy) ? ['objectNoShow'] : []
      if (now.getTime() < ms(b.startAt)) return [...extra, 'cancel']
      const asked: BookingAction[] = customer && b.askedDoneAt ? ['confirm', 'dispute'] : []
      return [...(customer ? asked : ['finish' as const]), ...extra, 'stop', 'reportNoShow']
    }
    case 'finished':
      if (!b.confirmBy || now.getTime() >= ms(b.confirmBy)) return extra
      return customer ? ['confirm', 'dispute', ...extra] : ['dispute', ...extra]
    case 'stopped': // either side may report a problem until an amount is agreed (confirmBy set)
      if (b.confirmBy) return []
      if (!b.stopStatedAt) return customer ? ['dispute'] : ['stateStopAmount', 'dispute']
      return customer ? ['answerStop', 'dispute'] : ['dispute']
    default:
      return []
  }
}

/** The button text: the customer asks for an "Additional task", the provider for a "Scope/quote review" (the same flow). */
export const actionLabel = (a: BookingAction, viewer: Viewer): string => t(a === 'additionalTask' && viewer === 'provider' ? 'booking.scopeReview' : (`booking.${a}` as Key))

/**
 * What cancelling now means, shown before the person confirms: free until 24 hours before the start, then half the price; a
 * provider cancellation refunds the customer fully. A root booking's paid additional tasks are cancelled with it, by the same rule.
 */
export function cancelStatement(b: Booking, viewer: Viewer, now = new Date()): string {
  const late = now.getTime() > ms(b.startAt) - FREE_CANCEL_HOURS * HOUR
  const kids = b.parentBookingId === null ? ` ${t('booking.cancelChildren')}` : ''
  if (viewer === 'provider') return t(late ? 'booking.cancelByProviderLate' : 'booking.cancelByProvider') + kids
  if (!late) return t('booking.cancelFree') + kids
  const fee = cents(lateFee(b.amount))
  return t('booking.cancelLate', { percent: LATE_CANCEL_SHARE * 100, fee: money(b, fee), back: money(b, cents(b.amount) - fee) }) + kids
}

/**
 * The tap on "Yes, cancel": the statement is worked out again with the time of the tap. When it differs from the one the person
 * read (the 24-hour mark passed meanwhile), nothing is sent: the new statement shows and a second tap confirms it.
 */
export function cancelTap(shown: string, b: Booking, viewer: Viewer, now = new Date()): { send: boolean; statement: string } {
  const statement = cancelStatement(b, viewer, now)
  return { send: statement === shown, statement }
}

/** The customer's choice after a stop: the stated amount goes to the provider, the rest of the price comes back. */
export function stopAnswerText(b: Booking): string {
  const share = cents(b.stopAmount ?? 0)
  return t('booking.stopAnswerText', { amount: money(b, share), back: money(b, cents(b.amount) - share) })
}
