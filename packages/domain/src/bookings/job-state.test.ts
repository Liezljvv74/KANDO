import { describe, expect, it } from 'vitest'

import { currentBookingOf, deriveJobState, type JobBookingInput, type JobButton, type JobViewer } from './job-state'

const at = (h: number) => new Date(Date.UTC(2026, 10, 10, 12 + h)) // hours from now
const now = at(0)
const booking = (o: Partial<JobBookingInput> = {}): JobBookingInput => ({ id: 'b1', status: 'confirmed', createdAt: at(-100), startAt: at(-1), ...o })
const reqOpen = { status: 'open', answerBy: at(24) }
const state = (viewer: JobViewer, b: Partial<JobBookingInput> | null, o: { request?: Parameters<typeof deriveJobState>[0]['request']; delayedFlag?: boolean; ready?: boolean } = {}) =>
  deriveJobState({ viewer, request: o.request ?? { status: 'booked', answerBy: at(24) }, bookings: b ? [booking(b)] : [], delayedFlag: o.delayedFlag ?? false, providerPayoutReady: o.ready ?? true, now })
const pick = (s: ReturnType<typeof deriveJobState>) => [s.key, s.section, s.buttons] as [string, string, JobButton[]]
const chat: JobButton[] = ['open_chat']

describe('currentBookingOf', () => {
  const mk = (id: string, status: string, h: number) => ({ id, status, createdAt: at(h) })
  it('is undefined without bookings', () => expect(currentBookingOf([])).toBeUndefined())
  it('a live booking beats a newer cancelled one', () => expect(currentBookingOf([mk('a', 'confirmed', -5), mk('b', 'cancelled', -1)])?.id).toBe('a'))
  it('a live booking beats a newer declined/expired one', () => expect(currentBookingOf([mk('a', 'awaiting-payment', -5), mk('b', 'declined', -1), mk('c', 'expired', -2)])?.id).toBe('a'))
  it('the newest live one wins', () => expect(currentBookingOf([mk('a', 'completed', -5), mk('b', 'confirmed', -1)])?.id).toBe('b'))
  it('only dead ones: the newest', () => expect(currentBookingOf([mk('a', 'expired', -5), mk('b', 'cancelled', -1)])?.id).toBe('b'))
})

describe('request without a booking', () => {
  it('open: request sent', () => {
    expect(pick(state('customer', null, { request: reqOpen }))).toEqual(['request_sent', 'active', ['cancel', 'open_chat']])
    expect(pick(state('provider', null, { request: reqOpen }))).toEqual(['request_sent', 'needs_you', ['send_quote', 'decline', 'open_chat']])
  })
  it('quoted: quote sent', () => {
    const request = { status: 'quoted', answerBy: at(24), quoteValidUntil: at(48) }
    expect(pick(state('customer', null, { request }))).toEqual(['quote_sent', 'needs_you', ['accept_quote', 'open_chat']])
    expect(pick(state('provider', null, { request }))).toEqual(['quote_sent', 'active', chat])
  })
  it('expired quote, unanswered request past its deadline, withdrawn, declined, expired: past', () => {
    for (const request of [{ status: 'quoted', answerBy: at(24), quoteValidUntil: at(-1) }, { status: 'open', answerBy: at(-1) }, { status: 'withdrawn', answerBy: at(24) }, { status: 'declined', answerBy: at(24) }, { status: 'expired', answerBy: at(24) }])
      for (const v of ['customer', 'provider'] as const) expect(pick(state(v, null, { request }))).toEqual(['declined_expired', 'past', []])
  })
  it('a lapsed booking on a request that reads open again falls back to the request', () => {
    expect(state('customer', { status: 'expired', startAt: at(5) }, { request: reqOpen }).key).toBe('request_sent')
    expect(state('customer', { status: 'awaiting-payment', payBy: at(-5), startAt: at(5) }, { request: reqOpen }).key).toBe('request_sent')
  })
})

describe('booking states, both viewers, exact buttons', () => {
  it('awaiting time (no agreed time): quote_sent, active, chat only', () => {
    for (const v of ['customer', 'provider'] as const) expect(pick(state(v, { status: 'awaiting-time', answerBy: at(10) }))).toEqual(['quote_sent', 'active', chat])
  })
  it('awaiting time past answerBy: declined_expired', () => expect(state('customer', { status: 'awaiting-time', answerBy: at(-1) }).key).toBe('declined_expired'))
  it('payment due', () => {
    const b = { status: 'awaiting-payment', payBy: at(10), startAt: at(30) }
    expect(pick(state('customer', b))).toEqual(['payment_due', 'needs_you', ['pay']])
    expect(pick(state('provider', b))).toEqual(['payment_due', 'active', []])
  })
  it('checkout not completed', () => {
    const b = { status: 'awaiting-payment', payBy: at(10), startAt: at(30), checkoutRef: 'cs_1' }
    expect(pick(state('customer', b))).toEqual(['checkout_not_completed', 'needs_you', ['pay']])
    expect(pick(state('provider', b))).toEqual(['checkout_not_completed', 'active', []])
  })
  it('paid, upcoming: customer paid_upcoming, provider before_start_time with the start time and finish', () => {
    const b = { status: 'confirmed', startAt: at(5) }
    expect(pick(state('customer', b))).toEqual(['paid_upcoming', 'active', ['open_chat', 'cancel']])
    const p = state('provider', b)
    expect(pick(p)).toEqual(['before_start_time', 'active', ['finish', 'open_chat', 'cancel']])
    expect(p.startAt).toEqual(at(5))
  })
  it('start time passed', () => {
    const b = { status: 'confirmed', startAt: at(-1) }
    expect(pick(state('customer', b))).toEqual(['start_time_passed', 'active', chat])
    expect(pick(state('provider', b))).toEqual(['start_time_passed', 'needs_you', ['finish', 'open_chat']])
  })
  it('customer asked "was it done" without a finish: customer confirms', () => {
    const b = { status: 'confirmed', startAt: at(-3), askedDoneAt: at(-1) }
    expect(pick(state('customer', b))).toEqual(['work_done_waiting', 'needs_you', ['confirm', 'report_problem', 'open_chat']])
    expect(state('provider', b).key).toBe('start_time_passed')
  })
  it('work done, waiting: provider never gets report_problem', () => {
    const b = { status: 'finished', confirmBy: at(48) }
    expect(pick(state('customer', b))).toEqual(['work_done_waiting', 'needs_you', ['confirm', 'report_problem', 'open_chat']])
    const p = state('provider', b)
    expect(pick(p)).toEqual(['work_done_waiting', 'active', chat])
    expect(p.buttons).not.toContain('report_problem')
  })
  it('payout on its way (finished past confirmBy, or completed and not released)', () => {
    for (const b of [{ status: 'finished', confirmBy: at(-1) }, { status: 'completed' }])
      for (const v of ['customer', 'provider'] as const) expect(pick(state(v, b))).toEqual(['payout_on_its_way', 'active', chat])
  })
  it('payout account missing', () => {
    const b = { status: 'finished', confirmBy: at(-1) }
    expect(pick(state('customer', b, { ready: false }))).toEqual(['payout_account_missing', 'active', []])
    expect(pick(state('provider', b, { ready: false }))).toEqual(['payout_account_missing', 'needs_you', []])
  })
  it('problem reported (disputed, no-show, stopped without an amount)', () => {
    for (const b of [{ status: 'disputed' }, { status: 'confirmed', noShow: 'provider' }, { status: 'stopped' }])
      for (const v of ['customer', 'provider'] as const) expect(pick(state(v, b))).toEqual(['problem_reported', 'active', ['open_chat', 'contact_support']])
  })
  it('stopped with an agreed amount is paid like finished', () => {
    expect(state('customer', { status: 'stopped', confirmBy: at(10) }).key).toBe('work_done_waiting')
    expect(state('customer', { status: 'stopped', confirmBy: at(-1) }).key).toBe('payout_on_its_way')
  })
  it('delayed beats payout_on_its_way and payout_account_missing for both viewers', () => {
    for (const b of [{ status: 'finished', confirmBy: at(-1) }, { status: 'completed' }])
      for (const v of ['customer', 'provider'] as const) for (const ready of [true, false]) expect(pick(state(v, b, { delayedFlag: true, ready }))).toEqual(['delayed', 'active', ['contact_support']])
    expect(state('customer', { status: 'finished', confirmBy: at(-1) }, { delayedFlag: true }).tone).toBe('bad')
  })
  it('completed: past, with the payout date', () => {
    for (const v of ['customer', 'provider'] as const) {
      const s = state(v, { status: 'completed', releasedAt: at(-2) })
      expect(pick(s)).toEqual(['completed', 'past', []])
      expect(s.paidOutAt).toEqual(at(-2))
    }
  })
  it('a stale flag on a released booking does not make it delayed', () => expect(state('customer', { status: 'completed', releasedAt: at(-2) }, { delayedFlag: true }).key).toBe('completed'))
  it('cancelled and refunded: past, chat; refund counted once (no Delayed when no flag open)', () => {
    for (const status of ['cancelled', 'refunded']) for (const v of ['customer', 'provider'] as const) expect(pick(state(v, { status }))).toEqual(['cancelled', 'past', chat])
  })
  it('a failed refund (open flag) is delayed, Active', () => expect(pick(state('customer', { status: 'cancelled' }, { delayedFlag: true }))).toEqual(['delayed', 'active', ['contact_support']]))
  it('declined, expired, withdrawn booking: past, no buttons', () => {
    for (const status of ['declined', 'expired', 'withdrawn']) for (const v of ['customer', 'provider'] as const) expect(pick(state(v, { status }, { request: { status: 'booked', answerBy: at(1) } }))).toEqual(['declined_expired', 'past', []])
  })
  it('a problem sits in active whatever else is open (flag, unready payout, unread-style states)', () => {
    for (const v of ['customer', 'provider'] as const) {
      const s = state(v, { status: 'disputed', confirmBy: at(-1) }, { delayedFlag: true, ready: false })
      expect(s.key).toBe('problem_reported')
      expect(s.section).toBe('active')
    }
  })
  it('a live booking beats a newer cancelled one in the derived state', () => {
    const s = deriveJobState({ viewer: 'customer', request: { status: 'booked', answerBy: at(1) }, bookings: [booking({ id: 'a', status: 'confirmed', startAt: at(5), createdAt: at(-5) }), booking({ id: 'b', status: 'cancelled', createdAt: at(-1) })], delayedFlag: false, providerPayoutReady: true, now })
    expect(s.key).toBe('paid_upcoming')
  })
})
