import { navGuard } from './go'

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(), back: jest.fn() } }))

test('the same route twice within 1 s navigates once', () => {
  const ok = navGuard()
  expect(ok('/a', 0)).toBe(true)
  expect(ok('/a', 500)).toBe(false)
})

test('a different route or after 1 s navigates again', () => {
  const ok = navGuard()
  expect(ok('/a', 0)).toBe(true)
  expect(ok('/b', 100)).toBe(true)
  expect(ok('/b', 1200)).toBe(true)
})
