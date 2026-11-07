import { bookingShownStatus } from './rules'

/** Pure rules for the one job state (spec 4.4, section rules 8b point 5). No database: the server feeds it rows, the phone only renders the key. */

export type JobStateKey =
  | 'request_sent' | 'quote_sent' | 'payment_due' | 'checkout_not_completed' | 'paid_upcoming' | 'before_start_time' | 'start_time_passed'
  | 'work_done_waiting' | 'payout_on_its_way' | 'payout_account_missing' | 'problem_reported' | 'delayed' | 'completed' | 'cancelled' | 'declined_expired' | 'time_to_agree'

export type JobButton = 'accept_quote' | 'ask_question' | 'send_quote' | 'decline' | 'pay' | 'cancel' | 'finish' | 'confirm' | 'report_problem' | 'contact_support' | 'open_chat' | 'agree_time'

export type JobViewer = 'customer' | 'provider'
export type JobSection = 'needs_you' | 'active' | 'past'
export type JobTone = 'info' | 'ok' | 'warn' | 'bad'

/** The request fields the rule needs. `quoteValidUntil`: the live quote's expiry (null/absent: none or still valid). */
export type JobRequestInput = { status: string; answerBy: Date | null; quoteValidUntil?: Date | null }

/** The booking fields the rule needs (all DB columns, minus what the DTO hides). */
export type JobBookingInput = {
  id: string
  status: string
  createdAt: Date
  startAt: Date
  answerBy?: Date | null
  payBy?: Date | null
  releasedAt?: Date | null
  confirmBy?: Date | null
  askedDoneAt?: Date | null
  checkoutRef?: string | null
  noShow?: string | null
  /** awaiting-time: which side proposed the time that waits for the other (bookings.time_proposed_by); null/absent: none proposed. */
  timeProposedBy?: string | null
  /** When the open checkout was created. No column holds it today (checkout_ref is JSON {sessionId,url,expiresAt}); null/absent: unknown. */
  checkoutStartedAt?: Date | null
  /** The checkout session's deadline (stored expiresAt): past it, the session certainly did not complete. */
  checkoutExpiresAt?: Date | null
}

/** A checkout younger than this may still be in the customer's hands: not yet "did not go through" (the old CONFIRMING_MS of the phone). */
export const CHECKOUT_PATIENCE_MS = 10 * 60_000

const DEAD = ['expired', 'declined', 'withdrawn', 'cancelled', 'refunded']

/** The booking every screen shows as the request's current one: a live booking first (newest), else the newest of all. */
export function currentBookingOf<B extends { id: string; status: string; createdAt: Date }>(bookings: B[]): B | undefined {
  const newest = (xs: B[]) => xs.reduce<B | undefined>((a, b) => (!a || b.createdAt > a.createdAt || (+b.createdAt === +a.createdAt && b.id > a.id) ? b : a), undefined)
  return newest(bookings.filter((b) => !DEAD.includes(b.status))) ?? newest(bookings)
}

/**
 * `cancel` means "withdraw the request" on request_sent and "cancel the booking" on a booking: the label comes from key + viewer.
 * A provider on a cancelled booking with an open refund flag deliberately gets `delayed` (owner may confirm later).
 * The provider never receives `paid_upcoming`: `before_start_time` replaces it (task 3.2 shows the "you receive net" text from the money fields).
 * `finished` with a null confirmBy falls into the payout stage (finish.ts always sets confirmBy).
 * `time_to_agree` (awaiting-time with a time proposed by one side): spec 4.4 has no row for it, the owner will be told.
 */
type Out = { key: JobStateKey; section: JobSection; tone: JobTone; buttons: JobButton[]; paidOutAt?: Date; startAt?: Date }

/**
 * Decisions where the spec table and the stored statuses do not line up:
 * - the request's own state is used when there is no booking, or when the current booking lapsed (expired/declined/withdrawn) and the job reads open again.
 * - `awaiting-time` (quote accepted, time not agreed yet) has no row: shown as `quote_sent` (Active, open chat); it is `declined_expired` once answerBy passed.
 * - `checkout_not_completed` = awaiting-payment with a checkout reference older than CHECKOUT_PATIENCE_MS or whose session deadline passed (the phone-memory pay state is gone).
 * - the customer's "Withdraw request" is the `cancel` button; no JobButton exists for set-up-payouts, additional task, review, receipt, no-show: the app derives them from the key.
 * - `before_start_time` is provider-only (the table shows a customer nothing special): the customer sees `paid_upcoming`. It returns `startAt`.
 * - confirmed + noShow reported, `disputed`, and `stopped` without an agreed amount (no confirmBy) are `problem_reported`; `stopped` with confirmBy is paid like `finished`.
 * - confirmed past start with askedDoneAt: the customer gets `work_done_waiting` (confirm or report); the provider still gets `start_time_passed`.
 * - the payout stage is finished past confirmBy, or completed/stopped-agreed without releasedAt; `delayedFlag` beats it, and beats `cancelled`/`refunded` (failed refund),
 *   but never a released booking (stale flag) and never `problem_reported` (the dispute is still open).
 */
export function deriveJobState(i: {
  viewer: JobViewer
  request: JobRequestInput
  bookings: JobBookingInput[]
  delayedFlag: boolean
  providerPayoutReady: boolean
  now: Date
}): Out {
  const { viewer, request, now } = i
  const customer = viewer === 'customer'
  const out = (key: JobStateKey, section: JobSection, tone: JobTone, buttons: JobButton[], extra: Partial<Out> = {}): Out => ({ key, section, tone, buttons, ...extra })
  const chat: JobButton[] = ['open_chat']
  const dead = out('declined_expired', 'past', 'info', [])

  const b = currentBookingOf(i.bookings)
  const shown = b ? bookingShownStatus({ status: b.status, answerBy: b.answerBy ?? null, payBy: b.payBy ?? null }, now) : undefined

  if (!b || (shown && ['expired', 'declined', 'withdrawn'].includes(shown) && ['open', 'quoted'].includes(request.status))) {
    if (['expired', 'withdrawn', 'declined'].includes(request.status)) return dead
    if (request.status === 'quoted') {
      if (request.quoteValidUntil && request.quoteValidUntil <= now) return dead
      return customer ? out('quote_sent', 'needs_you', 'warn', ['accept_quote', 'ask_question', ...chat]) : out('quote_sent', 'active', 'info', chat)
    }
    if (request.status === 'open' && request.answerBy && request.answerBy <= now) return dead
    return customer ? out('request_sent', 'active', 'info', ['cancel', ...chat]) : out('request_sent', 'needs_you', 'warn', ['send_quote', 'decline', ...chat])
  }

  const delayed = out('delayed', 'active', 'bad', ['contact_support'])
  const problem = out('problem_reported', 'active', 'bad', ['open_chat', 'contact_support'])
  const status = shown!
  const paidOut = b.releasedAt ?? undefined
  const payoutStage = () => {
    if (i.delayedFlag) return delayed
    if (!i.providerPayoutReady) return customer ? out('payout_account_missing', 'active', 'info', []) : out('payout_account_missing', 'needs_you', 'warn', [])
    return out('payout_on_its_way', 'active', 'ok', chat)
  }
  const waiting = () => (customer ? out('work_done_waiting', 'needs_you', 'warn', ['confirm', 'report_problem', ...chat]) : out('work_done_waiting', 'active', 'info', chat))

  switch (status) {
    case 'awaiting-time':
      if (b.timeProposedBy) return b.timeProposedBy === viewer ? out('time_to_agree', 'active', 'info', chat) : out('time_to_agree', 'needs_you', 'warn', ['agree_time', ...chat])
      return out('quote_sent', 'active', 'info', chat)
    case 'awaiting-payment': {
      // checkout_not_completed when the session expired (checkoutExpiresAt past), or its start is older than the patience; no known timestamp: still payment_due
      const expired = !!b.checkoutExpiresAt && now > b.checkoutExpiresAt
      const old = !!b.checkoutStartedAt && now.getTime() - b.checkoutStartedAt.getTime() > CHECKOUT_PATIENCE_MS
      const stale = !!b.checkoutRef && (expired || old)
      const key = stale ? 'checkout_not_completed' : 'payment_due'
      return customer ? out(key, 'needs_you', 'warn', ['pay']) : out(key, 'active', 'info', [])
    }
    case 'confirmed': {
      if (b.noShow) return problem
      if (b.startAt > now) {
        if (customer) return out('paid_upcoming', 'active', 'ok', ['open_chat', 'cancel'])
        return out('before_start_time', 'active', 'info', ['finish', 'open_chat', 'cancel'], { startAt: b.startAt })
      }
      if (customer) return b.askedDoneAt ? waiting() : out('start_time_passed', 'active', 'info', chat)
      return out('start_time_passed', 'needs_you', 'warn', ['finish', ...chat])
    }
    case 'finished':
      return b.confirmBy && b.confirmBy > now ? waiting() : payoutStage()
    case 'stopped':
      if (!b.confirmBy) return problem
      return b.confirmBy > now ? waiting() : payoutStage()
    case 'disputed':
      return problem
    case 'completed':
      return paidOut ? out('completed', 'past', 'ok', [], { paidOutAt: paidOut }) : payoutStage()
    case 'cancelled':
    case 'refunded':
      return i.delayedFlag ? delayed : out('cancelled', 'past', 'info', chat)
    default: // expired, declined, withdrawn
      return dead
  }
}
