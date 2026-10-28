import { createFieldSaver, type SaveStatus } from './use-field-save'

const flushPromises = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}
const setup = (save: (v: string) => Promise<unknown>) => {
  const seen: SaveStatus[] = []
  const saver = createFieldSaver(save, 600, (s) => seen.push(s))
  return { saver, seen }
}

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

test('two quick changes become one request with the last value', async () => {
  const save = jest.fn(async (_: string) => {})
  const { saver, seen } = setup(save)
  saver.set('a')
  jest.advanceTimersByTime(300)
  saver.set('ab')
  jest.advanceTimersByTime(599)
  expect(save).not.toHaveBeenCalled()
  jest.advanceTimersByTime(1)
  await flushPromises()
  expect(save).toHaveBeenCalledTimes(1)
  expect(save).toHaveBeenCalledWith('ab')
  expect(seen.at(-1)).toBe('saved')
})

test('flush saves immediately and nothing is sent twice', async () => {
  const save = jest.fn(async (_: string) => {})
  const { saver } = setup(save)
  saver.set('x')
  saver.flush()
  await flushPromises()
  expect(save).toHaveBeenCalledWith('x')
  jest.advanceTimersByTime(2000)
  expect(save).toHaveBeenCalledTimes(1)
})

test('a rejected save marks error and retry resends the same value', async () => {
  const save = jest.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined)
  const { saver, seen } = setup(save)
  saver.set('typed')
  saver.flush()
  await flushPromises()
  expect(seen.at(-1)).toBe('error')
  saver.retry()
  await flushPromises()
  expect(save).toHaveBeenCalledTimes(2)
  expect(save).toHaveBeenLastCalledWith('typed')
  expect(seen.at(-1)).toBe('saved')
})

test('a change typed while a save is in flight is sent after it, in order', async () => {
  let release!: () => void
  const save = jest.fn((_: string) => new Promise<void>((r) => (release = r)))
  const { saver, seen } = setup(save)
  saver.set('a')
  saver.flush()
  saver.set('ab')
  saver.flush()
  expect(save).toHaveBeenCalledTimes(1)
  release()
  await flushPromises()
  expect(save).toHaveBeenCalledTimes(2)
  expect(save).toHaveBeenLastCalledWith('ab')
  release()
  await flushPromises()
  expect(seen.at(-1)).toBe('saved')
})

test('dispose sends a pending change so nothing typed is lost', async () => {
  const save = jest.fn(async (_: string) => {})
  const { saver } = setup(save)
  saver.set('late')
  saver.dispose()
  await flushPromises()
  expect(save).toHaveBeenCalledWith('late')
  jest.advanceTimersByTime(2000)
  expect(save).toHaveBeenCalledTimes(1)
})

test('flush waits for the request in flight and the follow-up with the newest value', async () => {
  const sent: string[] = []
  const gates: (() => void)[] = []
  const save = jest.fn((v: string) => new Promise<void>((res) => { sent.push(v); gates.push(res) }))
  const { saver } = setup(save)
  saver.set('a')
  saver.flush() // 'a' is in flight
  saver.set('ab') // typed while it runs
  let done = false
  void saver.flush().then(() => { done = true })
  await flushPromises()
  expect(done).toBe(false)
  gates[0]()
  await flushPromises()
  expect(sent).toEqual(['a', 'ab'])
  expect(done).toBe(false) // the follow-up is still running
  gates[1]()
  await flushPromises()
  expect(done).toBe(true)
})
