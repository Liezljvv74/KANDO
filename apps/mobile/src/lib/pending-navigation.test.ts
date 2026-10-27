import { clearPending, consumePending, peekPending as usePendingValue, readyToNavigate, setPending } from './pending-navigation'

afterEach(clearPending)

test('set, consume once, then nothing', () => {
  setPending({ path: '/my-profile', welcome: true })
  expect(consumePending()).toEqual({ path: '/my-profile', welcome: true })
  expect(consumePending()).toBeNull()
})

test('clearPending drops it (sign-out)', () => {
  setPending({ path: '/my-profile' })
  clearPending()
  expect(consumePending()).toBeNull()
})

test('readyToNavigate: only with a target and a visible profile tab', () => {
  const p = { path: '/my-profile' as const }
  expect(readyToNavigate(null, { isProvider: true })).toBe(false)
  expect(readyToNavigate(p, null)).toBe(false)
  expect(readyToNavigate(p, { isProvider: false })).toBe(false)
  expect(readyToNavigate(p, { isProvider: true })).toBe(true)
})

test('the layout order: not ready keeps the target, ready consumes it once', () => {
  setPending({ path: '/my-profile', welcome: true })
  const step = (me: { isProvider: boolean } | null) => (readyToNavigate(usePendingValue(), me) ? consumePending() : null)
  expect(step({ isProvider: false })).toBeNull()
  expect(step({ isProvider: true })).toEqual({ path: '/my-profile', welcome: true })
  expect(step({ isProvider: true })).toBeNull()
})
