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
  // Only the values we know are passed: a text that still shows a {name} is skipped for its Plain, then Bare, variant (no clause for what is unknown).
  const p: Record<string, string | number> = {}
  const price = (n: number) => formatPrice({ priceType: 'fixed', price: n, currency: ctx.currency ?? 'EUR' })
  if (ctx.amount !== undefined) p.amount = price(ctx.amount)
  if (ctx.net !== undefined) p.net = price(ctx.net)
  if (ctx.date) p.date = formatWhen(ctx.date)
  if (ctx.startAt) p.time = formatWhen(ctx.startAt)
  if (ctx.number !== undefined) p.number = ctx.number
  let id: string = known(state.key) ? `${state.key}.${viewer}` : 'unknown'
  if (state.key === 'time_to_agree') id = `time_to_agree.${viewer}${state.buttons.includes('agree_time') ? '' : 'Waiting'}`
  else if (state.key === 'delayed' && ctx.refund) id = viewer === 'customer' ? 'delayed.customerRefund' : 'delayed.providerCancelled'
  else if (state.key === 'cancelled' && viewer === 'customer' && ctx.date) id = 'cancelled.customerRefunded'
  const pick = (field: 'title' | 'body') => {
    for (const suffix of ['', 'Plain', 'Bare']) {
      const key = `job.state.${id}.${field}${suffix}`
      const text = t(key as Key, p)
      if (text !== key && !/\{\w+\}/.test(text)) return text
    }
    return t(`job.state.unknown.${field}` as Key)
  }
  return { title: pick('title'), body: pick('body') }
}

/** The amounts and dates a booking's state text names (spec 4.4); what the DTO does not carry stays empty and reads "–". */
export function bookingStateCtx(b: { amount: number; currency: string; payBy: string | null; confirmBy: string | null; answerBy: string | null; startAt: string; jobNumber?: number; status: string; jobState?: JobStateDto }): StateCtx {
  const key = b.jobState?.key
  // a date only from the field that truly means it; every other state reads without a date
  const date = key === 'payment_due' || key === 'checkout_not_completed' ? b.payBy : key === 'completed' ? b.jobState?.paidOutAt : key === 'work_done_waiting' || key === 'payout_on_its_way' ? b.confirmBy : key === 'request_sent' || key === 'time_to_agree' ? b.answerBy : undefined
  return { amount: b.amount, currency: b.currency, date, startAt: b.jobState?.startAt ?? b.startAt, number: b.jobNumber, refund: b.status === 'cancelled' }
}

/** The same for a request; `quote` is its newest live quote when the screen has loaded it. */
export function requestStateCtx(r: { answerBy: string; jobNumber?: number; jobState?: JobStateDto }, quote?: { amount: number; currency: string; expiresAt: string }): StateCtx {
  return { amount: quote?.amount, currency: quote?.currency, date: quote?.expiresAt ?? (r.jobState?.key === 'quote_sent' ? undefined : r.answerBy), number: r.jobNumber }
}
