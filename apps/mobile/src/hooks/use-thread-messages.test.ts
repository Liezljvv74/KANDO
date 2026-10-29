import type { Message } from '@kando/contract'

import { ApiError } from '@/api/client'
import { MESSAGES_PAGE } from '@kando/contract'

import { createMessageFeed, POLL_SECONDS } from './use-thread-messages'

const msg = (n: number, extra: Partial<Message> = {}): Message => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  threadId: 't1',
  mine: false,
  kind: 'text',
  body: `m${n}`,
  photoUrl: null,
  card: null,
  createdAt: `2027-01-05T09:00:0${n}.000Z`,
  ...extra,
})
const cursorOf = (m: Message) => `${m.createdAt}|${m.id}`
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
const setup = (list: jest.Mock) => {
  const seen: Message[][] = []
  const errors: (string | null)[] = []
  const caught = jest.fn()
  const feed = createMessageFeed(list, (m) => seen.push(m), (e) => errors.push(e), caught)
  return { feed, seen, errors, caught }
}

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

test('polls with the last cursor and appends', async () => {
  const list = jest.fn().mockResolvedValueOnce([msg(1), msg(2)]).mockResolvedValueOnce([msg(3)]).mockResolvedValue([])
  const { feed, seen } = setup(list)
  feed.start()
  await flush()
  expect(list).toHaveBeenLastCalledWith(undefined)
  expect(seen.at(-1)!.map((m) => m.body)).toEqual(['m1', 'm2'])
  jest.advanceTimersByTime(POLL_SECONDS * 1000)
  await flush()
  expect(list).toHaveBeenLastCalledWith(cursorOf(msg(2)))
  expect(seen.at(-1)!.map((m) => m.body)).toEqual(['m1', 'm2', 'm3'])
  jest.advanceTimersByTime(POLL_SECONDS * 1000)
  await flush()
  expect(list).toHaveBeenLastCalledWith(cursorOf(msg(3)))
  feed.stop()
})

test('stops polling when unfocused', async () => {
  const list = jest.fn().mockResolvedValue([])
  const { feed } = setup(list)
  feed.start()
  await flush()
  expect(list).toHaveBeenCalledTimes(1)
  feed.stop()
  jest.advanceTimersByTime(POLL_SECONDS * 5000)
  await flush()
  expect(list).toHaveBeenCalledTimes(1)
  feed.start() // focused again: loads at once
  await flush()
  expect(list).toHaveBeenCalledTimes(2)
  feed.stop()
})

test('never shows the same message twice', async () => {
  const list = jest.fn().mockResolvedValueOnce([msg(1)]).mockResolvedValueOnce([msg(1), msg(2)]).mockResolvedValue([])
  const { feed, seen } = setup(list)
  feed.start()
  await flush()
  feed.add(msg(2, { mine: true })) // my own send arrives before the poll returns it
  jest.advanceTimersByTime(POLL_SECONDS * 1000)
  await flush()
  expect(seen.at(-1)!.map((m) => m.id)).toEqual([msg(1).id, msg(2).id])
  feed.add(msg(2))
  expect(seen.at(-1)).toHaveLength(2)
  feed.stop()
})

test('a sent message does not move the cursor past unread ones', async () => {
  const list = jest.fn().mockResolvedValue([])
  const { feed } = setup(list)
  feed.add(msg(5, { mine: true }))
  feed.start()
  await flush()
  expect(list).toHaveBeenLastCalledWith(undefined)
  feed.stop()
})

test('an error pauses with back-off and clears when a poll works again', async () => {
  const list = jest.fn().mockRejectedValueOnce(new ApiError(0, 'network')).mockRejectedValueOnce(new ApiError(0, 'network')).mockResolvedValue([msg(1)])
  const { feed, errors, seen } = setup(list)
  feed.start()
  await flush()
  expect(errors.at(-1)).toBe('network')
  jest.advanceTimersByTime(POLL_SECONDS * 2000 - 1)
  await flush()
  expect(list).toHaveBeenCalledTimes(1) // waits twice the normal interval
  jest.advanceTimersByTime(1)
  await flush()
  expect(list).toHaveBeenCalledTimes(2)
  jest.advanceTimersByTime(POLL_SECONDS * 4000) // twice again
  await flush()
  expect(list).toHaveBeenCalledTimes(3)
  expect(errors.at(-1)).toBeNull()
  expect(seen.at(-1)).toHaveLength(1)
  feed.stop()
})

test('a result that arrives after stop is dropped', async () => {
  let resolve!: (m: Message[]) => void
  const list = jest.fn().mockReturnValue(new Promise<Message[]>((r) => (resolve = r)))
  const { feed, seen } = setup(list)
  feed.start()
  feed.stop()
  resolve([msg(1)])
  await flush()
  expect(seen).toEqual([])
  jest.advanceTimersByTime(POLL_SECONDS * 10_000)
  expect(list).toHaveBeenCalledTimes(1)
})

const page = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => msg(0, { id: `00000000-0000-4000-8000-${String(from + i).padStart(12, '0')}`, createdAt: `2027-01-05T09:00:00.${String(from + i).padStart(3, '0')}Z` }))

test('a long chat is read page after page without waiting, then settles into the interval', async () => {
  const p1 = page(0, MESSAGES_PAGE)
  const p2 = page(MESSAGES_PAGE, MESSAGES_PAGE)
  const p3 = page(2 * MESSAGES_PAGE, 7)
  const list = jest.fn().mockResolvedValueOnce(p1).mockResolvedValueOnce(p2).mockResolvedValueOnce(p3).mockResolvedValue([])
  const { feed, seen, caught } = setup(list)
  feed.start()
  await flush()
  expect(list).toHaveBeenCalledTimes(3) // no timer advanced
  expect(list.mock.calls[1][0]).toBe(cursorOf(p1.at(-1)!))
  expect(list.mock.calls[2][0]).toBe(cursorOf(p2.at(-1)!))
  expect(seen.at(-1)).toHaveLength(2 * MESSAGES_PAGE + 7)
  expect(caught).toHaveBeenCalledTimes(1) // only at the end of the catch-up
  jest.advanceTimersByTime(POLL_SECONDS * 1000)
  await flush()
  expect(list).toHaveBeenCalledTimes(4)
  expect(caught).toHaveBeenCalledTimes(1)
  feed.stop()
})

test('a thread that does not exist (404) stops the polling for good', async () => {
  const list = jest.fn().mockRejectedValue(new ApiError(404, 'Not found'))
  const { feed, errors } = setup(list)
  feed.start()
  await flush()
  expect(errors.at(-1)).toBe('Not found')
  jest.advanceTimersByTime(POLL_SECONDS * 100_000)
  await flush()
  expect(list).toHaveBeenCalledTimes(1)
})
