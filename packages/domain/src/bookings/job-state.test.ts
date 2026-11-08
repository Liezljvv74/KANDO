import { describe, expect, it } from 'vitest'

import { CHECKOUT_PATIENCE_MS, currentBookingOf, deriveJobState, leadState, type JobBookingInput, type JobButton, type JobViewer } from './job-state'

const at = (h: number) => new Date(Date.UTC(2026, 10, 10, 12 + h)) // hours from now
const now = at(0)
const booking = (o: Partial<JobBookingInput> = {}): JobBookingInput => ({ id: 'b1', status: 'confirmed', createdAt: at(-100), startAt: at(-1), ...o })
const reqOpen = { status: 'open', answerBy: at(24) }
const state = (viewer: JobViewer, b: Partial<JobBookingInput> | null, o: { request?: Parameters<typeof deriveJobState>[0]['request']; delayedFlag?: boolean; ready?: boolean; unread?: boolean } = {}) =>
  deriveJobState({ viewer, request: o.request ?? { status: 'booked', answerBy: at(24) }, bookings: b ? [booking(b)] : [], delayedFlag: o.delayedFlag ?? false, providerPayoutReady: o.ready ?? true, unread: o.unread ?? false, now })
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
    expect(pick(state('customer', null, { request }))).toEqual(['quote_sent', 'needs_you', ['accept_quote', 'ask_question', 'open_chat', 'cancel']])
    expect(pick(state('provider', null, { request }))).toEqual(['quote_sent', 'active', ['send_quote', 'decline', 'open_chat']])
  })
  it('expired quote, unanswered request past its deadline, withdrawn, declined, expired: past', () => {
    for (const request of [{ status: 'quoted', answerBy: at(24), quoteValidUntil: at(-1) }, { status: 'open', answerBy: at(-1) }, { status: 'withdrawn', answerBy: at(24) }, { status: 'declined', answerBy: at(24) }, { status: 'expired', answerBy: at(24) }])
      for (const v of ['customer', 'provider'] as const) expect(pick(state(v, null, { request }))).toEqual(['declined_expired', 'past', v === 'customer' ? ['ask_someone_else'] : []])
  })
  it('a lapsed booking on a request that reads open again falls back to the request', () => {
    expect(state('customer', { status: 'expired', startAt: at(5) }, { request: reqOpen }).key).toBe('request_sent')
    expect(state('customer', { status: 'awaiting-payment', payBy: at(-5), startAt: at(5) }, { request: reqOpen }).key).toBe('request_sent')
  })
})

describe('booking states, both viewers, exact buttons', () => {
  it('awaiting time (no agreed time): quote_sent, active, chat only', () => {
    expect(pick(state('customer', { status: 'awaiting-time', answerBy: at(10) }))).toEqual(['quote_sent', 'active', ['enter_time', 'open_chat', 'withdraw']])
    expect(pick(state('provider', { status: 'awaiting-time', answerBy: at(10) }))).toEqual(['quote_sent', 'active', ['enter_time', 'open_chat']])
  })
  it('a proposed time waits for the other side', () => {
    const b = { status: 'awaiting-time', answerBy: at(10), timeProposedBy: 'customer' }
    expect(pick(state('customer', b))).toEqual(['time_to_agree', 'active', ['enter_time', 'open_chat', 'withdraw']])
    expect(pick(state('provider', b))).toEqual(['time_to_agree', 'needs_you', ['agree_time', 'enter_time', 'open_chat']])
    expect(pick(state('customer', { ...b, timeProposedBy: 'provider' }))).toEqual(['time_to_agree', 'needs_you', ['agree_time', 'enter_time', 'open_chat', 'withdraw']])
  })
  it('awaiting time past answerBy: declined_expired', () => expect(state('customer', { status: 'awaiting-time', answerBy: at(-1) }).key).toBe('declined_expired'))
  it('payment due', () => {
    const b = { status: 'awaiting-payment', payBy: at(10), startAt: at(30) }
    expect(pick(state('customer', b))).toEqual(['payment_due', 'needs_you', ['pay', 'withdraw']])
    expect(pick(state('provider', b))).toEqual(['payment_due', 'active', []])
  })
  it('a fresh or unknown-age checkout is still payment due', () => {
    const b = { status: 'awaiting-payment', payBy: at(10), startAt: at(30), checkoutRef: 'cs_1' }
    expect(state('customer', { ...b, checkoutStartedAt: new Date(now.getTime() - CHECKOUT_PATIENCE_MS) }).key).toBe('payment_due')
    expect(pick(state('customer', { ...b, checkoutStartedAt: new Date(now.getTime() - 60_000) }))).toEqual(['payment_due', 'needs_you', ['pay', 'withdraw']])
    expect(state('customer', b).key).toBe('payment_due')
  })
  it('checkout expiry: expired is not completed; unexpired follows the patience; no timestamp is payment due', () => {
    const b = { status: 'awaiting-payment', payBy: at(10), startAt: at(30), checkoutRef: 'cs_1' }
    const young = new Date(now.getTime() - 60_000)
    const old = new Date(now.getTime() - CHECKOUT_PATIENCE_MS - 1)
    expect(state('customer', { ...b, checkoutExpiresAt: new Date(now.getTime() - 1), checkoutStartedAt: young }).key).toBe('checkout_not_completed')
    expect(state('customer', { ...b, checkoutExpiresAt: new Date(now.getTime() - 1) }).key).toBe('checkout_not_completed')
    expect(state('customer', { ...b, checkoutExpiresAt: at(1), checkoutStartedAt: young }).key).toBe('payment_due')
    expect(state('customer', { ...b, checkoutExpiresAt: at(1), checkoutStartedAt: old }).key).toBe('checkout_not_completed')
    expect(state('customer', b).key).toBe('payment_due')
  })
  it('checkout not completed', () => {
    const b = { status: 'awaiting-payment', payBy: at(10), startAt: at(30), checkoutRef: 'cs_1', checkoutStartedAt: new Date(now.getTime() - CHECKOUT_PATIENCE_MS - 1) }
    expect(pick(state('customer', b))).toEqual(['checkout_not_completed', 'needs_you', ['pay', 'withdraw']])
    expect(pick(state('provider', b))).toEqual(['checkout_not_completed', 'active', []])
  })
  it('paid, upcoming: customer paid_upcoming, provider before_start_time with the start time and finish', () => {
    const b = { status: 'confirmed', startAt: at(5) }
    expect(pick(state('customer', b))).toEqual(['paid_upcoming', 'active', ['add_task', 'open_chat', 'cancel']])
    const p = state('provider', b)
    expect(pick(p)).toEqual(['before_start_time', 'active', ['finish', 'add_task', 'open_chat', 'cancel']])
    expect(p.startAt).toEqual(at(5))
  })
  it('an additional task offers no further task', () => {
    expect(state('customer', { status: 'confirmed', startAt: at(5), parentBookingId: 'root' }).buttons).toEqual(['open_chat', 'cancel'])
    expect(state('provider', { status: 'finished', confirmBy: at(48), parentBookingId: 'root' }).buttons).toEqual(chat)
  })
  it('start time passed', () => {
    const b = { status: 'confirmed', startAt: at(-1) }
    expect(pick(state('customer', b))).toEqual(['start_time_passed', 'active', ['open_chat', 'no_show', 'add_task', 'stop']])
    expect(pick(state('provider', b))).toEqual(['start_time_passed', 'needs_you', ['finish', 'add_task', 'open_chat', 'stop', 'no_show']])
  })
  it('customer asked "was it done" without a finish: customer confirms', () => {
    const b = { status: 'confirmed', startAt: at(-3), askedDoneAt: at(-1) }
    expect(pick(state('customer', b))).toEqual(['work_done_waiting', 'needs_you', ['confirm', 'report_problem', 'open_chat', 'add_task', 'stop', 'no_show']])
    expect(state('provider', b).key).toBe('start_time_passed')
  })
  it('work done, waiting: provider never gets report_problem', () => {
    const b = { status: 'finished', confirmBy: at(48) }
    expect(pick(state('customer', b))).toEqual(['work_done_waiting', 'needs_you', ['confirm', 'report_problem', 'open_chat', 'add_task']])
    const p = state('provider', b)
    expect(pick(p)).toEqual(['work_done_waiting', 'active', ['open_chat', 'add_task']])
    expect(p.buttons).not.toContain('report_problem')
  })
  it('payout on its way (finished past confirmBy, or completed and not released)', () => {
    for (const b of [{ status: 'finished', confirmBy: at(-1) }, { status: 'completed' }])
      for (const v of ['customer', 'provider'] as const) expect(pick(state(v, b))).toEqual(['payout_on_its_way', 'active', b.status === 'finished' ? ['open_chat', 'add_task'] : chat])
  })
  it('payout account missing: only the spec table buttons (no add_task)', () => {
    const b = { status: 'finished', confirmBy: at(-1) }
    expect(pick(state('customer', b, { ready: false }))).toEqual(['payout_account_missing', 'active', []])
    expect(pick(state('provider', b, { ready: false }))).toEqual(['payout_account_missing', 'needs_you', ['set_up_payouts']])
  })
  it('problem reported (disputed, no-show, stopped without an amount)', () => {
    for (const b of [{ status: 'disputed' }, { status: 'confirmed', noShow: 'provider' }])
      for (const v of ['customer', 'provider'] as const) expect(pick(state(v, b))).toEqual(['problem_reported', 'active', ['open_chat', 'contact_support']])
  })
  it('the reported side may object until the deadline', () => {
    const b = { status: 'confirmed', noShow: 'provider', noShowObjectBy: at(10) }
    expect(state('provider', b).buttons).toEqual(['open_chat', 'contact_support', 'object_no_show'])
    expect(state('customer', b).buttons).toEqual(['open_chat', 'contact_support'])
    expect(state('provider', { ...b, noShowObjectBy: at(-1) }).buttons).toEqual(['open_chat', 'contact_support'])
  })
  it('stopped without an agreed amount: the provider states it, the customer answers it, both may report a problem', () => {
    const base = ['open_chat', 'contact_support']
    expect(state('provider', { status: 'stopped' }).buttons).toEqual([...base, 'state_stop_amount', 'report_problem'])
    expect(state('customer', { status: 'stopped' }).buttons).toEqual([...base, 'report_problem'])
    expect(state('provider', { status: 'stopped', stopStatedAt: at(-1) }).buttons).toEqual([...base, 'report_problem'])
    expect(state('customer', { status: 'stopped', stopStatedAt: at(-1) }).buttons).toEqual([...base, 'answer_stop', 'report_problem'])
    for (const v of ['customer', 'provider'] as const) expect(state(v, { status: 'stopped' }).key).toBe('problem_reported')
  })
  it('stopped with an agreed amount is paid like finished', () => {
    expect(state('customer', { status: 'stopped', confirmBy: at(10) }).key).toBe('work_done_waiting')
    expect(state('customer', { status: 'stopped', confirmBy: at(-1) }).key).toBe('payout_on_its_way')
  })
  it('delayed beats payout_on_its_way and payout_account_missing for both viewers, with Contact support only (spec 4.4)', () => {
    for (const b of [{ status: 'finished', confirmBy: at(-1) }, { status: 'completed' }])
      for (const v of ['customer', 'provider'] as const) for (const ready of [true, false]) expect(pick(state(v, b, { delayedFlag: true, ready }))).toEqual(['delayed', 'active', ['contact_support']])
    expect(state('customer', { status: 'finished', confirmBy: at(-1) }, { delayedFlag: true }).tone).toBe('bad')
  })
  it('completed: past, with the payout date', () => {
    for (const v of ['customer', 'provider'] as const) {
      const s = state(v, { status: 'completed', releasedAt: at(-2) })
      expect(pick(s)).toEqual(['completed', 'past', ['review', 'receipt']])
      expect(s.paidOutAt).toEqual(at(-2))
    }
  })
  it('a stale flag on a released booking does not make it delayed', () => expect(state('customer', { status: 'completed', releasedAt: at(-2) }, { delayedFlag: true }).key).toBe('completed'))
  it('cancelled and refunded: past, chat; refund counted once (no Delayed when no flag open)', () => {
    for (const status of ['cancelled', 'refunded']) for (const v of ['customer', 'provider'] as const) expect(pick(state(v, { status }))).toEqual(['cancelled', 'past', chat])
  })
  it('a failed refund (open flag) is delayed, Active', () => expect(pick(state('customer', { status: 'cancelled' }, { delayedFlag: true }))).toEqual(['delayed', 'active', ['contact_support']]))
  it('declined, expired, withdrawn booking: past, no buttons', () => {
    for (const status of ['declined', 'expired', 'withdrawn']) for (const v of ['customer', 'provider'] as const) expect(pick(state(v, { status }, { request: { status: 'booked', answerBy: at(1) } }))).toEqual(['declined_expired', 'past', v === 'customer' ? ['ask_someone_else'] : []])
  })
  it('a problem sits in active whatever else is open (flag, unready payout, unread-style states)', () => {
    for (const v of ['customer', 'provider'] as const)
      for (const b of [{ status: 'stopped' }, { status: 'confirmed', noShow: 'provider', startAt: at(-1) }]) {
        const s = state(v, b, { delayedFlag: true, ready: false })
        expect(s.key).toBe('problem_reported')
        expect(s.section).toBe('active')
      }
  })
  it('a decided dispute whose money step keeps failing (open flag) is delayed (spec 4.4); without the flag it stays problem_reported', () => {
    for (const v of ['customer', 'provider'] as const) {
      expect(pick(state(v, { status: 'disputed', confirmBy: at(-1) }, { delayedFlag: true, ready: false }))).toEqual(['delayed', 'active', ['contact_support']])
      expect(state(v, { status: 'disputed' }).key).toBe('problem_reported')
    }
  })
  it('a live booking beats a newer cancelled one in the derived state', () => {
    const s = deriveJobState({ viewer: 'customer', request: { status: 'booked', answerBy: at(1) }, bookings: [booking({ id: 'a', status: 'confirmed', startAt: at(5), createdAt: at(-5) }), booking({ id: 'b', status: 'cancelled', createdAt: at(-1) })], delayedFlag: false, providerPayoutReady: true, now })
    expect(s.key).toBe('paid_upcoming')
  })
})

describe('unread messages (spec 8b point 5)', () => {
  const b = { status: 'confirmed', startAt: at(5) }
  it('an active job with an unread message goes to needs_you and counts', () => {
    const s = state('customer', b, { unread: true })
    expect([s.key, s.section, s.countsForMe]).toEqual(['paid_upcoming', 'needs_you', true])
  })
  it('no unread: the section is unchanged and does not count', () => {
    const s = state('customer', b)
    expect([s.section, s.countsForMe]).toEqual(['active', false])
  })
  it('a problem or a delayed payment stays active, and counts only when unread', () => {
    for (const [bk, o] of [[{ status: 'disputed' }, {}], [{ status: 'completed' }, { delayedFlag: true }]] as const) {
      const s = state('customer', bk, { ...o, unread: true })
      expect([s.section, s.countsForMe]).toEqual(['active', true])
      expect([state('customer', bk, o).section, state('customer', bk, o).countsForMe]).toEqual(['active', false])
    }
  })
  it('a past job with an unread message goes to needs_you', () => {
    const s = state('customer', { status: 'completed', releasedAt: at(-2) }, { unread: true })
    expect([s.key, s.section, s.countsForMe]).toEqual(['completed', 'needs_you', true])
  })
  it('needs_you counts even without unread', () => expect(state('provider', { status: 'confirmed', startAt: at(-1) }).countsForMe).toBe(true))
  it('a request without a booking also follows the rule', () => {
    const s = state('customer', null, { request: reqOpen, unread: true })
    expect([s.key, s.section, s.countsForMe]).toEqual(['request_sent', 'needs_you', true])
  })
})

describe('leadState (a job with additional tasks, one list row)', () => {
  const st = (key: string, section: 'needs_you' | 'active' | 'past', countsForMe = section === 'needs_you') => ({ key, section, countsForMe }) as unknown as ReturnType<typeof deriveJobState>
  it('a task that needs the viewer leads a running or settled root', () => {
    const task = st('request_sent', 'needs_you')
    expect(leadState(st('payout_on_its_way', 'active'), [task])).toBe(task)
    expect(leadState(st('completed', 'past'), [st('declined_expired', 'past'), task])).toBe(task)
  })
  it('a live task keeps a settled root out of Past', () => {
    const task = st('payment_due', 'active')
    expect(leadState(st('completed', 'past'), [task])).toBe(task)
  })
  it('the root wins a tie, and over settled tasks', () => {
    const root = st('start_time_passed', 'needs_you')
    expect(leadState(root, [st('payment_due', 'needs_you')])).toBe(root)
    const done = st('completed', 'past')
    expect(leadState(done, [st('cancelled', 'past')])).toBe(done)
    expect(leadState(done, [])).toBe(done)
  })
  it('an unread problem (counts, stays active) beats a running task', () => {
    const root = st('problem_reported', 'active', true)
    expect(leadState(root, [st('payment_due', 'needs_you')])).toBe(root)
  })
})
