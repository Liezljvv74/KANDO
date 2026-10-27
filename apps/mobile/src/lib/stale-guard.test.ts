import { createStaleGuard } from './stale-guard'

test('a response older than one already applied is ignored', () => {
  const stamp = createStaleGuard()
  const first = stamp()
  const second = stamp()
  expect(second()).toBe(true) // the newer request answered first
  expect(first()).toBe(false) // the older one must not replace it
})

test('answers arriving in order are all applied', () => {
  const stamp = createStaleGuard()
  const first = stamp()
  expect(first()).toBe(true)
  const second = stamp()
  expect(second()).toBe(true)
})
