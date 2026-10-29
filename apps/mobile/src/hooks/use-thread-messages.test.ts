import type { Message } from '@kando/contract'

import { ApiError } from '@/api/client'
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
  const feed = createMessageFeed(list, (m) => seen.push(m), (e) => errors.push(e))
  return { feed, seen, errors }
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
