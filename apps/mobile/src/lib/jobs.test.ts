import { counterOf, sectionsToLoad, tabBadge } from './jobs'

test('tabBadge sums both sides', () => {
  expect(tabBadge({ customer: 2, provider: 3 })).toBe(5)
  expect(tabBadge({ customer: 0, provider: 0 })).toBe(0)
})

test('a job needing me and unread counts once', () => {
  // the server's needsYou already holds the jobs with unread messages, each once: unread is never added on top
  expect(counterOf({ needsYou: 2, unread: 1 })).toBe(2)
  expect(counterOf(undefined)).toBe(0)
})

test('past section is folded by default', () => {
  expect(sectionsToLoad()).toEqual(['needs_you', 'active'])
  expect(sectionsToLoad(true)).toEqual(['needs_you', 'active', 'past'])
})
