let mockGeneration = 0
jest.mock('@/hooks/use-me', () => ({ signOutGeneration: () => mockGeneration }))

import { flowCache, nextStepHeld, type FlowData } from './flow-cache'

const me = { isProvider: true, firstName: 'A', lastName: 'B', birthDate: '1990-01-01', address: { postcode: '10115' } } as FlowData['me']
const data = (over: Partial<FlowData> = {}): FlowData => ({ me, profile: { missing: ['skills', 'service'], quoteSteps: ['payout'] }, docRows: [], payoutSent: false, ...over })

beforeEach(() => {
  mockGeneration++
  flowCache.clear()
})

test('nothing held: unknown', () => {
  expect(nextStepHeld('about')).toBe('unknown')
})
test('the screen just finished is never the next step', () => {
  flowCache.note(data())
  expect(nextStepHeld()).toEqual({ kind: 'about', path: expect.stringContaining('/my-profile/about') })
  expect(nextStepHeld('about')).toEqual({ kind: 'service', path: '/my-profile/service/new' })
})
test('same rules as nextStep: account first, payout last, a sent payout is not open', () => {
  flowCache.note(data({ me: { ...me, birthDate: null } as FlowData['me'], profile: { missing: [], quoteSteps: ['payout'] } }))
  expect(nextStepHeld('service')).toEqual({ kind: 'account', path: '/account' })
  expect(nextStepHeld('account')).toEqual({ kind: 'payout' })
  flowCache.note(data({ profile: { missing: [], quoteSteps: ['payout'] }, payoutSent: true }))
  expect(nextStepHeld('account')).toBeNull()
})
test('a step finished by an earlier Done stays finished until its refresh lands', () => {
  flowCache.note(data())
  const untrust = flowCache.trust('about')
  expect(nextStepHeld('service')).toEqual({ kind: 'payout' })
  untrust()
  expect(nextStepHeld('service')).toEqual({ kind: 'about', path: expect.stringContaining('/my-profile/about') })
})
test('data of a signed-out account is not used', () => {
  flowCache.note(data())
  mockGeneration++
  expect(nextStepHeld('about')).toBe('unknown')
})
test('data of a load that ran over a sign-out is not used', () => {
  const start = flowCache.begin()
  mockGeneration++
  flowCache.note(data(), start)
  expect(nextStepHeld('about')).toBe('unknown')
})
test('two loads answering in reverse order: the later-started one wins', () => {
  const older = flowCache.begin()
  const newer = flowCache.begin()
  flowCache.note(data({ profile: { missing: [], quoteSteps: [] } }), newer)
  flowCache.note(data(), older) // still lists About you as open
  expect(nextStepHeld('service')).toBeNull()
})
test('the first data noted keeps a step trusted before it', () => {
  const untrust = flowCache.trust('about')
  flowCache.note(data())
  expect(nextStepHeld('service')).toEqual({ kind: 'payout' })
  untrust()
})
