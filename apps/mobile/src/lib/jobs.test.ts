import { counterOf, countsStore, pastPage, tabBadge } from './jobs'

const page = (needsYou: number) => ({ counts: { needsYou, unread: 0 } })

test('tabBadge sums both sides', () => {
  expect(tabBadge({ customer: 2, provider: 3 })).toBe(5)
  expect(tabBadge({ customer: 0, provider: 0 })).toBe(0)
})

test('a job needing me and unread counts once', () => {
  // the server's needsYou already holds the jobs with unread messages, each once: unread is never added on top
  expect(counterOf({ needsYou: 2, unread: 1 })).toBe(2)
  expect(counterOf(undefined)).toBe(0)
})

test('past section is folded by default', async () => {
  const load = jest.fn().mockResolvedValue('past rows')
  expect(await pastPage(false, load)).toBeUndefined()
  expect(load).not.toHaveBeenCalled()
  expect(await pastPage(true, load)).toBe('past rows')
})

test('the counts store writes both counters, tells its readers and returns the pages', async () => {
  const store = countsStore((side) => Promise.resolve(page(side === 'customer' ? 2 : 3)))
  const heard = jest.fn()
  const stop = store.subscribe(heard)
  const pages = await store.load(['customer', 'provider'])
  expect(store.get()).toEqual({ customer: 2, provider: 3 })
  expect(pages.provider).toEqual(page(3))
  expect(heard).toHaveBeenCalledTimes(1)
  await store.load(['customer', 'provider']) // same numbers: readers are not woken
  expect(heard).toHaveBeenCalledTimes(1)
  await store.load(['customer']) // a side not asked for (no longer a provider) is 0
  expect(store.get()).toEqual({ customer: 2, provider: 0 })
  store.clear()
  expect(store.get()).toEqual({ customer: 0, provider: 0 })
  stop()
})

test('callers in the same moment share one fetch per side', async () => {
  const fetchSide = jest.fn((side: 'customer' | 'provider') => Promise.resolve(page(side === 'customer' ? 1 : 0)))
  const store = countsStore(fetchSide)
  const [a, b] = await Promise.all([store.load(['customer', 'provider']), store.load(['customer', 'provider'])])
  expect(a).toBe(b)
  expect(fetchSide).toHaveBeenCalledTimes(2)
  await store.load(['customer']) // after the flight lands, a new load fetches again
  expect(fetchSide).toHaveBeenCalledTimes(3)
})
