import { JOB_STATE_KEYS, type JobStateDto } from '@kando/contract'

import type { Lang } from '@kando/i18n/app'
import { bookingStateCtx, requestStateCtx, stateText } from './job-state-text'

let mockLang: Lang = 'de'
jest.mock('@/i18n', () => ({ t: (key: string, p?: Record<string, string | number>) => jest.requireActual('@kando/i18n/app').t(mockLang, key, p) }))
jest.mock('@/lib/booking-time', () => ({ formatWhen: (iso: string) => `WHEN(${iso})` }))
jest.mock('@/lib/format', () => ({ formatAmount: (n: number) => `EUR ${n}` }))

const st = (key: string, extra: Partial<JobStateDto> = {}) => ({ key, section: 'active', tone: 'info', buttons: [], countsForMe: false, ...extra }) as unknown as JobStateDto
const ctx = { amount: 100, net: 88, currency: 'EUR', date: '2027-01-05T10:00:00Z', startAt: '2027-01-04T09:00:00Z', number: 1042 }

test.each(['de', 'en'] as const)('every state key has a text for both viewers in %s, placeholders resolved', (l) => {
  mockLang = l
  for (const key of JOB_STATE_KEYS)
    for (const viewer of ['customer', 'provider'] as const) {
      const x = stateText(st(key), viewer, ctx)!
      expect(x.title.length).toBeGreaterThan(0)
      expect(x.body.length).toBeGreaterThan(0)
      expect(`${x.title} ${x.body}`).not.toMatch(/[{}]|job\.state/)
    }
})

const ctxs = [{}, { number: 7 }, { amount: 10 }, { net: 8, date: '2027-01-05T10:00:00Z' }, { refund: true }, { refund: true, amount: 10, number: 7 }, ctx]
const variants = (key: string) => [st(key), ...(key === 'time_to_agree' ? [st(key, { buttons: ['agree_time'] })] : [])]

test.each(['de', 'en'] as const)('with any missing value no text prints a placeholder, a dash or a double space (%s)', (l) => {
  mockLang = l
  for (const c of ctxs)
    for (const key of JOB_STATE_KEYS)
      for (const state of variants(key))
        for (const viewer of ['customer', 'provider'] as const) {
          const x = stateText(state, viewer, c)!
          for (const text of [x.title, x.body]) {
            expect(text).not.toMatch(/[{}]| - | {2}|job\.state/)
            expect(text.length).toBeGreaterThan(0)
          }
        }
})

test('texts without the unknown clause (German)', () => {
  mockLang = 'de'
  expect(stateText(st('paid_upcoming'), 'provider')!.body).toBe('Du erhältst das Geld nach dem Auftrag.')
  expect(stateText(st('problem_reported'), 'customer', { number: 5 })!.body).toBe('Unser Team entscheidet. Auftrag #5. Bis dahin wird kein Geld bewegt.')
  expect(stateText(st('time_to_agree'), 'customer')!.title).toBe('Termin vorgeschlagen')
  expect(stateText(st('time_to_agree'), 'provider')!.body).toContain('Du hast einen Termin vorgeschlagen')
  expect(stateText(st('delayed'), 'customer', { refund: true, amount: 12, number: 3 })!.title).toBe('Erstattung verzögert')
  expect(stateText(st('delayed'), 'customer', { refund: true, amount: 12, number: 3 })!.body).toBe('Wir konnten deine Erstattung von EUR 12 nicht abschließen. Unser Team kümmert sich darum. Auftrag #3.')
})

test('a provider on a cancelled and delayed booking is owed nothing: no amount waits for them', () => {
  mockLang = 'en'
  const x = stateText(st('delayed'), 'provider', { refund: true, net: 8, number: 3 })!
  expect(x.body).toBe('A payment step is delayed. Our team is on it.')
  expect(stateText(st('delayed'), 'provider', { net: 8, number: 3 })!.body).toContain('EUR 8 is waiting')
  expect(stateText(st('delayed'), 'provider', { number: 3 })!.body).not.toContain('waiting')
})

test('amounts, dates and the job number are filled in', () => {
  mockLang = 'en'
  expect(stateText(st('payment_due'), 'customer', ctx)!.title).toBe('Pay EUR 100')
  expect(stateText(st('payout_on_its_way'), 'provider', ctx)!.body).toContain('EUR 88')
  expect(stateText(st('problem_reported'), 'customer', ctx)!.body).toContain('#1042')
  expect(stateText(st('before_start_time'), 'provider', ctx)!.body).toContain('WHEN(2027-01-04T09:00:00Z)')
})

test('a cancelled job says when the refund was made; a failed refund reads Refund delayed', () => {
  mockLang = 'en'
  expect(stateText(st('cancelled'), 'customer', ctx)!.body).toBe('EUR 100 refunded on WHEN(2027-01-05T10:00:00Z).')
  expect(stateText(st('cancelled'), 'customer')!.body).toContain('on its way')
  expect(stateText(st('delayed'), 'customer', { ...ctx, refund: true })!.title).toBe('Refund delayed')
  expect(stateText(st('delayed'), 'customer', ctx)!.title).toBe('Delayed')
})

test('time_to_agree reads differently for the side that proposed', () => {
  mockLang = 'en'
  const receiving = stateText(st('time_to_agree', { buttons: ['agree_time'] }), 'customer', ctx)!
  const waiting = stateText(st('time_to_agree'), 'customer', ctx)!
  expect(receiving.body).toContain('agree')
  expect(waiting.body).toContain('You proposed')
})

test('an unknown key shows the generic text; a missing state is null', () => {
  mockLang = 'en'
  expect(stateText(st('something_new'), 'customer')).toEqual({ title: 'Job status', body: 'Open the job to see what happens next.' })
  expect(stateText(undefined, 'customer')).toBeNull()
})

test('a cancelled booking never gets a date from answerBy', () => {
  const b = { amount: 50, currency: 'EUR', payBy: 'P', confirmBy: 'C', answerBy: 'A', startAt: 'S', status: 'cancelled' }
  expect(bookingStateCtx({ ...b, jobState: st('cancelled') }).date).toBeUndefined()
  expect(bookingStateCtx({ ...b, jobState: st('time_to_agree') }).date).toBe('A')
})

test('the context helpers pick the date that belongs to the state', () => {
  const b = { amount: 50, currency: 'EUR', payBy: 'P', confirmBy: 'C', answerBy: 'A', startAt: 'S', status: 'confirmed', jobNumber: 3 }
  expect(bookingStateCtx({ ...b, jobState: st('payment_due') }).date).toBe('P')
  expect(bookingStateCtx({ ...b, jobState: st('work_done_waiting') }).date).toBe('C')
  expect(bookingStateCtx({ ...b, jobState: st('completed', { paidOutAt: 'O' }) }).date).toBe('O')
  expect(requestStateCtx({ answerBy: 'A', jobState: st('request_sent') }).date).toBe('A')
  expect(requestStateCtx({ answerBy: 'A', jobState: st('quote_sent') }).date).toBeUndefined()
  expect(requestStateCtx({ answerBy: 'A' }, { amount: 9, currency: 'EUR', expiresAt: 'E' }).date).toBe('E')
})

test.each([
  ['en', 'A payment step', 'We could not complete your refund. Our team is on it. Job #3.'],
  ['de', 'Ein Zahlungsschritt', 'Wir konnten deine Erstattung nicht abschließen. Unser Team kümmert sich darum. Auftrag #3.'],
] as const)('a delayed refund names no amount (%s): a late cancel refunds only part', (l, _p, body) => {
  mockLang = l
  const base = { amount: 100, currency: 'EUR', payBy: null, confirmBy: null, answerBy: null, startAt: 'S', jobNumber: 3 }
  for (const status of ['cancelled', 'refunded']) {
    const c = bookingStateCtx({ ...base, status, jobState: st('delayed') })
    expect(c.amount).toBeUndefined()
    expect(c.refund).toBe(true)
    expect(stateText(st('delayed'), 'customer', c)!.body).toBe(body)
  }
})

test.each(['de', 'en'] as const)('a stopped job names the stop amount, or none (%s)', (l) => {
  mockLang = l
  const base = { amount: 100, currency: 'EUR', payBy: null, confirmBy: 'C', answerBy: null, startAt: 'S', status: 'stopped' }
  const withStop = bookingStateCtx({ ...base, stopAmount: 40, jobState: st('work_done_waiting') })
  expect(withStop.amount).toBe(40)
  expect(stateText(st('work_done_waiting'), 'customer', withStop)!.body).toContain('EUR 40')
  expect(stateText(st('work_done_waiting'), 'customer', withStop)!.body).not.toContain('EUR 100')
  const none = bookingStateCtx({ ...base, stopAmount: null, jobState: st('work_done_waiting') })
  expect(none.amount).toBeUndefined()
  expect(stateText(st('work_done_waiting'), 'customer', none)!.body).not.toMatch(/EUR|[{}]/)
})

test('payout_on_its_way never names a date (confirmBy is already past)', () => {
  const b = { amount: 50, currency: 'EUR', payBy: null, confirmBy: 'C', answerBy: null, startAt: 'S', status: 'finished' }
  expect(bookingStateCtx({ ...b, jobState: st('payout_on_its_way') }).date).toBeUndefined()
})
