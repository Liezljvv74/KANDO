import type { JOB_BUTTONS, JOB_STATE_KEYS } from '@kando/contract'
import { bookingShownStatus } from './rules'
import { REVIEW_VISIBLE_DAYS } from './ending-rules'

/** Pure rules for the one job state (spec 4.4, section rules 8b point 5). No database: the server feeds it rows, the phone only renders the key. */

/** One list of keys and buttons: the contract's (JOB_STATE_KEYS, JOB_BUTTONS). */
export type JobStateKey = (typeof JOB_STATE_KEYS)[number]
export type JobButton = (typeof JOB_BUTTONS)[number]

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
  /** An additional task (no further task hangs off it); the no-show objection deadline; when a stopped job's amount was stated. */
  parentBookingId?: string | null
  noShowObjectBy?: Date | null
  stopStatedAt?: Date | null
  /** completed: when it was completed, and whether the viewer already reviewed the other side (the rating window, REVIEW_VISIBLE_DAYS). */
  completedAt?: Date | null
  reviewedByViewer?: boolean
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
 * Buttons beyond the spec table (task 4.2: the phone renders buttons from here only, so every flow it had keeps a button):
 * `withdraw` (customer leaves an unpaid booking), `enter_time`, `stop`, `state_stop_amount`, `answer_stop`, `object_no_show`, `accept_no_show`, and
 * `add_task` on a root booking for both sides (the provider's label is "Scope/quote review") from paid until finished, as before (not on delayed or payout_account_missing: the spec table rules there).
 */
type Out = { key: JobStateKey; section: JobSection; tone: JobTone; buttons: JobButton[]; paidOutAt?: Date; startAt?: Date }
/** `countsForMe`: the job adds to the viewer's "Needs you" counter (section needs_you, or a problem/delayed job with an unread message). */
export type JobState = Out & { countsForMe: boolean }

/**
 * Decisions where the spec table and the stored statuses do not line up:
 * - the request's own state is used when there is no booking, or when the current booking lapsed (expired/declined/withdrawn) and the job reads open again.
 * - `awaiting-time` (quote accepted, time not agreed yet) has no row: shown as `quote_sent` (Active, open chat); it is `declined_expired` once answerBy passed.
 * - `checkout_not_completed` = awaiting-payment with a checkout reference older than CHECKOUT_PATIENCE_MS or whose session deadline passed (the phone-memory pay state is gone).
 * - the customer's "Withdraw request" is the `cancel` button (request_sent, and quote_sent without a booking, where it declines the quote); the other table buttons (set_up_payouts, add_task, review, receipt, no_show, ask_someone_else) are emitted per the spec table.
 * - `unread` (spec 8b point 5, 4.2): an active or past job with an unread message moves to needs_you, except problem_reported and delayed, which stay active (red) and only count.
 * - `before_start_time` is provider-only (the table shows a customer nothing special): the customer sees `paid_upcoming`. It returns `startAt`.
 * - confirmed + noShow reported, `disputed`, and `stopped` without an agreed amount (no confirmBy) are `problem_reported`; `stopped` with confirmBy is paid like `finished`. On a stopped job the customer has one way to disagree: `answer_stop` once the amount is stated (disagree opens the dispute), `report_problem` only before that.
 * - confirmed past start with askedDoneAt: the customer gets `work_done_waiting` (confirm or report); the provider still gets `start_time_passed`.
 * - the payout stage is finished past confirmBy, or completed/stopped-agreed without releasedAt; `delayedFlag` beats it, and beats `cancelled`/`refunded` (failed refund),
 *   but never a released booking (stale flag) and never a no-show or an unagreed stop (`problem_reported`). A `disputed` booking with the flag is
 *   `delayed`: spec 4.4, "a dispute decision's money step keeps failing" (the lookup does not count a flag while the dispute is undecided).
 */
export function deriveJobState(i: {
  viewer: JobViewer
  /** The viewer has an unread message in the job's chat. */
  unread?: boolean
  /** The provider has not yet opened a job whose quote was accepted and paid: it counts on the Jobs tab. */
  quoteAccepted?: boolean
  request: JobRequestInput
  bookings: JobBookingInput[]
  delayedFlag: boolean
  providerPayoutReady: boolean
  now: Date
}): JobState {
  const s = baseState(i)
  const stays = s.key === 'problem_reported' || s.key === 'delayed'
  const section = i.unread && !stays ? 'needs_you' : s.section
  return { ...s, section, countsForMe: section === 'needs_you' || !!i.unread || !!i.quoteAccepted }
}

/**
 * The state a Jobs-list row shows for a job with additional tasks (spec 4.3: a task is part of its job, not a row of its own):
 * the most urgent of the root's and the tasks' states. Needs the viewer (countsForMe) beats running, running beats past; the root
 * wins a tie. So a task that needs the viewer puts the job under Needs you (counted once), and a live task keeps it out of Past.
 */
export function leadState<S extends JobState>(root: S, tasks: S[]): S {
  const rank = (s: S) => (s.countsForMe ? 0 : s.section !== 'past' ? 1 : 2)
  return tasks.reduce((lead, t) => (rank(t) < rank(lead) ? t : lead), root)
}

function baseState(i: Parameters<typeof deriveJobState>[0]): Out {
  const { viewer, request, now } = i
  const customer = viewer === 'customer'
  const out = (key: JobStateKey, section: JobSection, tone: JobTone, buttons: JobButton[], extra: Partial<Out> = {}): Out => ({ key, section, tone, buttons, ...extra })
  const chat: JobButton[] = ['open_chat']
  const dead = out('declined_expired', 'past', 'info', customer ? ['ask_someone_else'] : [])

  const b = currentBookingOf(i.bookings)
  const shown = b ? bookingShownStatus({ status: b.status, answerBy: b.answerBy ?? null, payBy: b.payBy ?? null }, now) : undefined

  if (!b || (shown && ['expired', 'declined', 'withdrawn'].includes(shown) && ['open', 'quoted'].includes(request.status))) {
    if (['expired', 'withdrawn', 'declined'].includes(request.status)) return dead
    if (request.status === 'quoted') {
      if (request.quoteValidUntil && request.quoteValidUntil <= now) return dead
      return customer ? out('quote_sent', 'needs_you', 'warn', ['accept_quote', 'ask_question', ...chat, 'cancel']) : out('quote_sent', 'active', 'info', ['send_quote', 'decline', ...chat]) // a revised quote, or decline, as before
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
    if (!i.providerPayoutReady) return customer ? out('payout_account_missing', 'active', 'info', chat) : out('payout_account_missing', 'needs_you', 'warn', ['set_up_payouts'])
    return out('payout_on_its_way', 'active', 'ok', chat)
  }
  const waiting = () => (customer ? out('work_done_waiting', 'needs_you', 'warn', ['confirm', 'report_problem', ...chat]) : out('work_done_waiting', 'active', 'info', chat))
  const withdraw: JobButton[] = customer ? ['withdraw'] : []
  const task: JobButton[] = !b.parentBookingId && !b.noShow ? ['add_task'] : []
  const plus = (s: Out, more: JobButton[]): Out => ({ ...s, buttons: [...s.buttons, ...more] })

  switch (status) {
    case 'awaiting-time':
      if (b.timeProposedBy) return b.timeProposedBy === viewer ? out('time_to_agree', 'active', 'info', ['enter_time', ...chat, ...withdraw]) : out('time_to_agree', 'needs_you', 'warn', ['agree_time', 'enter_time', ...chat, ...withdraw])
      return out('quote_sent', 'active', 'info', ['enter_time', ...chat, ...withdraw])
    case 'awaiting-payment': {
      // checkout_not_completed when the session expired (checkoutExpiresAt past), or its start is older than the patience; no known timestamp: still payment_due
      const expired = !!b.checkoutExpiresAt && now > b.checkoutExpiresAt
      const old = !!b.checkoutStartedAt && now.getTime() - b.checkoutStartedAt.getTime() > CHECKOUT_PATIENCE_MS
      const stale = !!b.checkoutRef && (expired || old)
      const key = stale ? 'checkout_not_completed' : 'payment_due'
      return customer ? out(key, 'needs_you', 'warn', ['pay', ...chat, 'withdraw']) : out(key, 'active', 'info', [...chat]) // the two can still talk while the payment is open
    }
    case 'confirmed': {
      if (b.noShow) return b.noShow === viewer && !!b.noShowObjectBy && now < b.noShowObjectBy ? plus(problem, ['object_no_show', 'accept_no_show']) : problem
      if (b.startAt > now) {
        if (customer) return out('paid_upcoming', 'active', 'ok', [...task, 'open_chat', 'cancel'])
        return out('before_start_time', 'active', 'info', ['finish', ...task, 'open_chat', 'cancel'], { startAt: b.startAt })
      }
      if (customer) return plus(b.askedDoneAt ? waiting() : out('start_time_passed', 'active', 'info', [...chat, 'no_show']), [...task, 'stop', ...(b.askedDoneAt ? ['no_show' as const] : [])])
      return out('start_time_passed', 'needs_you', 'warn', ['finish', ...task, ...chat, 'stop', 'no_show'])
    }
    case 'finished': {
      // spec 4.4: Delayed has only Contact support, Payout account missing only Set up payouts: no add_task there
      const s = b.confirmBy && b.confirmBy > now ? waiting() : payoutStage()
      return s.key === 'delayed' || s.key === 'payout_account_missing' ? s : plus(s, task)
    }
    case 'stopped':
      if (!b.confirmBy) return plus(problem, customer ? [b.stopStatedAt ? 'answer_stop' as const : 'report_problem' as const] : [...(b.stopStatedAt ? [] : ['state_stop_amount' as const]), 'report_problem'])
      return b.confirmBy > now ? waiting() : payoutStage()
    case 'disputed':
      return i.delayedFlag ? delayed : problem
    case 'completed':
      // the viewer's rating of the other side is still open (root job, not reviewed, window not over): the job stays under Needs you; `settled` in jobs.ts mirrors this
      if (paidOut && !b.parentBookingId && !b.reviewedByViewer && !!b.completedAt && now.getTime() < b.completedAt.getTime() + REVIEW_VISIBLE_DAYS * 86_400_000) return out('completed', 'needs_you', 'warn', ['review', 'receipt'], { paidOutAt: paidOut })
      return paidOut ? out('completed', 'past', 'ok', ['review', 'receipt'], { paidOutAt: paidOut }) : payoutStage()
    case 'cancelled':
    case 'refunded':
      return i.delayedFlag ? delayed : out('cancelled', 'past', 'info', chat)
    default: // expired, declined, withdrawn
      return dead
  }
}
