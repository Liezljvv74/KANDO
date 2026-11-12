const mockGeneration = 1
jest.mock('@/hooks/use-me', () => ({ signOutGeneration: () => mockGeneration }))
const mockLoadNext = jest.fn(async () => null)
const mockPayoutNotReady = jest.fn(() => false)
jest.mock('./flow-state', () => ({ loadNextStep: () => mockLoadNext(), payoutNotReady: () => mockPayoutNotReady() }))
const mockBack = jest.fn()
const mockReplace = jest.fn()
jest.mock('./go', () => ({ goBack: () => mockBack(), goReplace: (...a: unknown[]) => mockReplace(...a) }))
const mockFinish = jest.fn()
jest.mock('./finish-flow', () => ({ finishFlow: (...a: unknown[]) => mockFinish(...a) }))

import { pressDone, pressGuard, runDone } from './done-flow'
import { flowCache, type FlowData } from './flow-cache'
import type { NextStep } from './next-step'

const step: NextStep = { kind: 'service', path: '/my-profile/service/new' }
const never = () => new Promise<void>(() => {})
const base = { isProvider: true, wasOpen: true, missing: () => [], flush: () => {}, next: () => step }
const me = { isProvider: true, firstName: 'A', lastName: 'B', birthDate: '1990-01-01', address: { postcode: '10115' } } as FlowData['me']
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  for (const m of [mockLoadNext, mockBack, mockReplace, mockFinish]) m.mockClear()
  mockPayoutNotReady.mockReturnValue(false)
  flowCache.clear()
})

test('missing fields: missing, nothing is sent', () => {
  const sent = jest.fn()
  expect(runDone({ ...base, missing: () => ['s.price'], flush: sent })).toEqual({ type: 'missing', fields: ['s.price'] })
  expect(sent).not.toHaveBeenCalled()
})
test('a value the screen rejects (not a missing field): its text, nothing is sent', () => {
  const sent = jest.fn()
  expect(runDone({ ...base, invalid: () => 'bad', flush: sent })).toEqual({ type: 'invalid', text: 'bad' })
  expect(sent).not.toHaveBeenCalled()
})
test('a send that never answers does not hold Done back', () => {
  const sent = jest.fn(never)
  expect(runDone({ ...base, flush: sent })).toEqual({ type: 'next', step })
  expect(sent).toHaveBeenCalledTimes(1)
})
test('a flush that throws or rejects does not stop Done', async () => {
  expect(runDone({ ...base, flush: () => { throw new Error('x') } })).toEqual({ type: 'next', step })
  expect(runDone({ ...base, flush: () => Promise.reject(new Error('x')) })).toEqual({ type: 'next', step })
  await flush()
})
test('nothing held: My business', () => {
  expect(runDone({ ...base, next: () => 'unknown' })).toEqual({ type: 'myBusiness' })
})
test('nothing open: the end in the flow, a plain edit goes back', () => {
  expect(runDone({ ...base, next: () => null })).toEqual({ type: 'end', role: 'provider' })
  expect(runDone({ ...base, wasOpen: false, next: () => null })).toEqual({ type: 'edit' })
  expect(runDone({ ...base, wasOpen: false })).toEqual({ type: 'next', step })
})
test('a customer has nothing after the account: no held data needed', () => {
  expect(runDone({ ...base, isProvider: false, next: () => 'unknown' })).toEqual({ type: 'end', role: 'customer' })
  expect(runDone({ ...base, isProvider: false, wasOpen: false, next: () => 'unknown' })).toEqual({ type: 'edit' })
})
test('onSent runs once the send settled, never while it is out', async () => {
  const onSent = jest.fn()
  let done!: () => void
  runDone({ ...base, flush: () => new Promise<void>((r) => (done = r)), onSent })
  await flush()
  expect(onSent).not.toHaveBeenCalled()
  done()
  await flush()
  expect(onSent).toHaveBeenCalledTimes(1)
})

const cfg = (over = {}) => ({ isProvider: true, step: 'about' as const, missing: () => [], flush: never, ...over })

test('pressDone: held data and an open step: that step opens at once, no request, no pause', () => {
  flowCache.note({ me, profile: { missing: ['skills', 'service'], quoteSteps: [] }, docRows: [] })
  const out = pressDone(cfg(), true)
  expect(out).toEqual({ type: 'next', step })
  expect(mockReplace).toHaveBeenCalledWith(step.path) // in the same tick: no timer, no "Saved"
  expect(mockLoadNext).not.toHaveBeenCalled()
})
test('pressDone: after About you the next step is never About you', () => {
  flowCache.note({ me, profile: { missing: ['skills'], quoteSteps: [] }, docRows: [] })
  pressDone(cfg(), true)
  expect(mockReplace).not.toHaveBeenCalled()
  expect(mockFinish).toHaveBeenCalledWith('provider', false)
})
test('pressDone: a refused change still pending does not change where Done goes', () => {
  flowCache.note({ me, profile: { missing: ['service'], quoteSteps: [] }, docRows: [] })
  expect(pressDone(cfg({ flush: () => Promise.resolve(false) }), true)).toEqual({ type: 'next', step })
})
test('pressDone: nothing held opens My business', () => {
  expect(pressDone(cfg(), true)).toEqual({ type: 'myBusiness' })
  expect(mockReplace).toHaveBeenCalledWith('/my-profile')
})
test('pressDone: a plain edit goes back', () => {
  flowCache.note({ me, profile: { missing: [], quoteSteps: [] }, docRows: [] })
  pressDone(cfg(), false)
  expect(mockBack).toHaveBeenCalledTimes(1)
})
test('pressDone: the end of the flow keeps the payout-not-ready message', () => {
  flowCache.note({ me, profile: { missing: [], quoteSteps: [] }, docRows: [] })
  mockPayoutNotReady.mockReturnValue(true)
  pressDone(cfg(), true)
  expect(mockFinish).toHaveBeenCalledWith('provider', true)
})
test('pressDone: missing fields: nothing opens', () => {
  expect(pressDone(cfg({ missing: () => ['s.price'] }), true)).toEqual({ type: 'missing', fields: ['s.price'] })
  expect(mockReplace).not.toHaveBeenCalled()
  expect(mockFinish).not.toHaveBeenCalled()
  expect(mockBack).not.toHaveBeenCalled()
})
test('pressDone: payout next opens My business at once, the payout is not started from Done', () => {
  flowCache.note({ me, profile: { missing: [], quoteSteps: ['payout'] }, docRows: [] })
  expect(pressDone(cfg(), true)).toEqual({ type: 'next', step: { kind: 'payout' } })
  expect(mockReplace).toHaveBeenCalledWith('/my-profile')
})
test('pressDone: after the send the held data is refreshed; the finished step counts as done until then', async () => {
  flowCache.note({ me, profile: { missing: ['skills', 'service'], quoteSteps: [] }, docRows: [] })
  let sent!: () => void
  pressDone(cfg({ flush: () => new Promise<void>((r) => (sent = r)) }), true)
  mockReplace.mockClear()
  pressDone(cfg({ step: 'service' }), true) // the next screen's Done before the first send answered
  expect(mockFinish).toHaveBeenCalledWith('provider', false) // About you is not opened again
  expect(mockLoadNext).not.toHaveBeenCalled()
  sent()
  await flush()
  expect(mockLoadNext).toHaveBeenCalledTimes(1)
})
test('pressGuard: a second press after one that moved on is ignored until the screen shows again', () => {
  const fn = jest.fn(() => true)
  const g = pressGuard(fn)
  g.press()
  g.press()
  expect(fn).toHaveBeenCalledTimes(1)
  g.reset()
  g.press()
  expect(fn).toHaveBeenCalledTimes(2)
})
test('pressGuard: a press that showed a message does not block the next one', () => {
  const fn = jest.fn(() => false)
  const g = pressGuard(fn)
  g.press()
  g.press()
  expect(fn).toHaveBeenCalledTimes(2)
})
