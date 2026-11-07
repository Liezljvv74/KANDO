import { JOB_STATE_KEYS, type JobStateDto } from '@kando/contract'

import { t, type Key } from '@/i18n'
import { formatWhen } from '@/lib/booking-time'
import { formatPrice } from '@/lib/format'

export type StateCtx = {
  /** What the customer pays / what the provider receives (major units). */
  amount?: number
  net?: number
  currency?: string
  /** The date the text names (answer-by, pay-by, confirm-by, payout or refund date), ISO. */
  date?: string | null
  /** The job's start (before_start_time), ISO. */
  startAt?: string | null
  number?: number
  /** A cancelled job whose refund failed: "Refund delayed" instead of "Delayed". */
  refund?: boolean
}

const known = (key: string): key is (typeof JOB_STATE_KEYS)[number] => (JOB_STATE_KEYS as readonly string[]).includes(key)

/**
 * The plain title and body of the server's job state for one side. No state (an older server): null, the caller keeps its old text.
 * An unknown key (a newer server): a generic text.
 */
export function stateText(state: JobStateDto | undefined, viewer: 'customer' | 'provider', ctx: StateCtx = {}): { title: string; body: string } | null {
  if (!state) return null
  const money = (n: number | undefined, fallback: Key) => (n === undefined ? t(fallback) : formatPrice({ priceType: 'fixed', price: n, currency: ctx.currency ?? 'EUR' }))
  const p = {
    amount: money(ctx.amount, 'job.state.none'),
    net: money(ctx.net, 'job.state.none'),
    date: ctx.date ? formatWhen(ctx.date) : t('job.state.none'),
    time: ctx.startAt ? formatWhen(ctx.startAt) : t('job.state.none'),
    number: ctx.number ?? t('job.state.none'),
  }
  let id: string = known(state.key) ? `${state.key}.${viewer}` : 'unknown'
  if (state.key === 'time_to_agree') id = `time_to_agree.${viewer}${state.buttons.includes('agree_time') ? '' : 'Waiting'}`
  else if (state.key === 'delayed' && ctx.refund && viewer === 'customer') id = 'delayed.customerRefund'
  else if (state.key === 'cancelled' && viewer === 'customer' && ctx.date) id = 'cancelled.customerRefunded'
  return { title: t(`job.state.${id}.title` as Key, p), body: t(`job.state.${id}.body` as Key, p) }
}

/** The amounts and dates a booking's state text names (spec 4.4); what the DTO does not carry stays empty and reads "–". */
export function bookingStateCtx(b: { amount: number; currency: string; payBy: string | null; confirmBy: string | null; answerBy: string | null; startAt: string; jobNumber?: number; status: string; jobState?: JobStateDto }): StateCtx {
  const key = b.jobState?.key
  const date = key === 'payment_due' || key === 'checkout_not_completed' ? b.payBy : key === 'completed' ? b.jobState?.paidOutAt : key === 'work_done_waiting' || key === 'payout_on_its_way' ? b.confirmBy : b.answerBy
  return { amount: b.amount, currency: b.currency, date, startAt: b.jobState?.startAt ?? b.startAt, number: b.jobNumber, refund: b.status === 'cancelled' }
}

/** The same for a request; `quote` is its newest live quote when the screen has loaded it. */
export function requestStateCtx(r: { answerBy: string; jobNumber?: number; jobState?: JobStateDto }, quote?: { amount: number; currency: string; expiresAt: string }): StateCtx {
  return { amount: quote?.amount, currency: quote?.currency, date: quote?.expiresAt ?? (r.jobState?.key === 'quote_sent' ? undefined : r.answerBy), number: r.jobNumber }
}
