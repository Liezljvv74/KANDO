import { payoutState, saveSwitch } from './payouts'

test('payout card: ready wins, else waiting once the Stripe page was opened, else not started', () => {
  expect(payoutState(true, false)).toBe('ready')
  expect(payoutState(true, true)).toBe('ready')
  expect(payoutState(false, true)).toBe('waiting')
  expect(payoutState(undefined, true)).toBe('unknown')
  expect(payoutState(false, false)).toBe('notFinished')
  expect(payoutState(undefined, false)).toBe('unknown')
})

test('the invoicing consent switch goes back when its save fails', async () => {
  const shown: boolean[] = []
  await saveSwitch(true, (v) => shown.push(v), async () => {})
  expect(shown).toEqual([true])
  await expect(saveSwitch(true, (v) => shown.push(v), async () => Promise.reject(new Error('offline')))).rejects.toThrow('offline')
  expect(shown).toEqual([true, true, false])
})
