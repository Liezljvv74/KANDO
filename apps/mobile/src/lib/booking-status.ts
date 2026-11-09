import { DAY, FREE_CANCEL_HOURS, HOUR, LATE_CANCEL_SHARE, STOP_ANSWER_DAYS, type Booking, type JobStateDto } from '@kando/contract'

import { t, type Key } from '@/i18n'
import { formatWhen } from '@/lib/booking-time'
import { formatAmount } from '@/lib/format'

export type Viewer = 'customer' | 'provider'
type JobButton = JobStateDto['buttons'][number]
export type BookingAction =
  | 'withdraw'
  | 'enterTime'
  | 'confirmTime'
  | 'acceptNoShow'
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
const money = (b: Pick<Booking, 'currency'>, cents: number) => formatAmount(cents / 100, b.currency)
const cents = (x: number) => Math.round(x * 100)

/** Whole days left until `iso` (a started day counts), never below 0: the confirmation countdown. */
export const daysLeft = (iso: string, now = new Date()): number => Math.max(0, Math.ceil((ms(iso) - now.getTime()) / DAY))

/** What a late customer cancellation costs: half the price in whole cents, half up (the server's Math.round). */
export const lateFee = (amount: number): number => Math.round(cents(amount) * LATE_CANCEL_SHARE) / 100

/**
 * The status in plain words for the viewer: the detail line under a problem (no-show, stop, dispute) and an awaiting-time
 * booking's title. The payment stages (pay, waiting, payout) are the server's jobState text only.
 */
export function bookingStatusText(b: Booking, viewer: Viewer): string {
  const date = (iso: string | null) => (iso ? formatWhen(iso) : '')
  switch (b.status) {
    case 'confirmed':
      if (b.noShow) return t(b.noShow === viewer ? 'bookingStatus.noShowAgainstYou' : 'bookingStatus.noShowReported', { date: date(b.noShowObjectBy) })
      return t(b.askedDoneAt && viewer === 'customer' ? 'bookingStatus.askedDone' : 'bookingStatus.confirmed')
    case 'stopped':
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

/**
 * The booking step behind each of the server's job buttons (jobState.buttons decides which show; the server re-checks every step).
 * `cancel` is the booking's own; on a request without a booking the job page withdraws the request instead.
 */
export const BUTTON_ACTION: Partial<Record<JobButton, BookingAction>> = {
  withdraw: 'withdraw',
  enter_time: 'enterTime',
  agree_time: 'confirmTime',
  finish: 'finish',
  confirm: 'confirm',
  report_problem: 'dispute',
  add_task: 'additionalTask',
  cancel: 'cancel',
  stop: 'stop',
  no_show: 'reportNoShow',
  object_no_show: 'objectNoShow',
  accept_no_show: 'acceptNoShow',
  state_stop_amount: 'stateStopAmount',
  answer_stop: 'answerStop',
}

/** The button text: the customer asks for an "Additional task", the provider for a "Scope/quote review" (the same flow). */
export const actionLabel = (a: BookingAction, viewer: Viewer): string => t(a === 'additionalTask' && viewer === 'provider' ? 'booking.scopeReview' : a === 'objectNoShow' ? 'booking.objectNoShowShort' : (`booking.${a}` as Key))

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
