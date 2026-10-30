import { payoutState } from './payouts'

test('payout card: ready wins, else waiting once the Stripe page was opened, else not started', () => {
  expect(payoutState(true, false)).toBe('ready')
  expect(payoutState(true, true)).toBe('ready')
  expect(payoutState(false, true)).toBe('waiting')
  expect(payoutState(undefined, true)).toBe('unknown')
  expect(payoutState(false, false)).toBe('notFinished')
  expect(payoutState(undefined, false)).toBe('unknown')
})
