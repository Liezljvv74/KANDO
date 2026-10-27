import { clearPending, consumePending, readyToNavigate, setPending } from './pending-navigation'

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
