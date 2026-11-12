import { AppState } from 'react-native'
import { ApiError } from '@/api/client'
import { listEntries, dropAccount, replaceServiceRef } from '@/lib/pending-saves'
import { registerSender, startRunner } from '@/lib/pending-runner'
import { createFieldSaver, type SaveStatus } from './use-field-save'

const mockDisk: Record<string, string> = {}
jest.mock('expo-file-system', () => {
  class File {
    name: string
    constructor(_dir: unknown, name: string) {
      this.name = name
    }
    get exists() {
      return this.name in mockDisk
    }
    create() {
      mockDisk[this.name] = ''
    }
    async text() {
      return mockDisk[this.name]
    }
    async write(s: string) {
      mockDisk[this.name] = s
    }
    async move(to: File) {
      mockDisk[to.name] = mockDisk[this.name]
      delete mockDisk[this.name]
    }
  }
  return { File, Paths: { document: {} } }
})

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

test('flushNow (the app going to the background) sends the pending value at once', async () => {
  const save = jest.fn(async (_: string) => {})
  const { saver } = setup(save)
  saver.set('x')
  await saver.flushNow()
  expect(save).toHaveBeenCalledWith('x')
  expect(save).toHaveBeenCalledTimes(1)
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

test('commit resolves true after a successful save', async () => {
  const save = jest.fn(async (_: string) => {})
  const { saver } = setup(save)
  saver.set('a')
  const p = saver.commit()
  await flushPromises()
  await expect(p).resolves.toBe(true)
  expect(save).toHaveBeenCalledWith('a')
})

test('commit resolves false when the save rejects', async () => {
  const save = jest.fn().mockRejectedValue(new Error('x'))
  const { saver } = setup(save)
  saver.set('a')
  const p = saver.commit()
  await flushPromises()
  await expect(p).resolves.toBe(false)
})

test('commit resends a value whose last save failed and resolves true when the resend works', async () => {
  const save = jest.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined)
  const { saver, seen } = setup(save)
  saver.set('typed')
  await saver.flush()
  expect(seen.at(-1)).toBe('error')
  const p = saver.commit()
  await flushPromises()
  await expect(p).resolves.toBe(true)
  expect(save).toHaveBeenCalledTimes(2)
  expect(save).toHaveBeenLastCalledWith('typed')
})

test('a new change after a failed save, once saved, makes commit true', async () => {
  const save = jest.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined)
  const { saver } = setup(save)
  saver.set('a')
  await saver.flush()
  saver.set('ab')
  await expect(saver.commit()).resolves.toBe(true)
  expect(save).toHaveBeenLastCalledWith('ab')
  expect(save).toHaveBeenCalledTimes(2)
})

test('commit resolves true when nothing was typed', async () => {
  const save = jest.fn(async (_: string) => {})
  const { saver } = setup(save)
  await expect(saver.commit()).resolves.toBe(true)
  expect(save).not.toHaveBeenCalled()
})

test('flush still resolves without a value (unchanged)', async () => {
  const save = jest.fn(async (_: string) => {})
  const { saver } = setup(save)
  await expect(saver.flush()).resolves.toBeUndefined()
  expect(save).not.toHaveBeenCalled()
})

describe('with a queue (the pending-saves store)', () => {
  let stop: () => void
  let sender: jest.Mock
  const queue = { key: 'about:bio', kind: 'about' as const, accountId: 'a', route: '/my-profile/about?field=bio', field: 'bio', toBody: (v: string) => (v ? { bio: v } : null) }
  const queued = (save: (v: string) => Promise<unknown> = jest.fn()) => {
    const seen: SaveStatus[] = []
    return { saver: createFieldSaver(save, 600, (s) => seen.push(s), () => queue), seen, save }
  }
  const entry = () => listEntries('a').find((e) => e.key === queue.key)

  beforeEach(() => {
    jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never)
    sender = jest.fn(async () => {})
    registerSender('about', sender)
    stop = startRunner(() => 'a')
  })
  afterEach(() => {
    stop()
    dropAccount('a')
    jest.restoreAllMocks()
  })

  test('a failed save leaves the entry as retry, a later success of a newer value clears it', async () => {
    sender.mockRejectedValueOnce(new ApiError(503, 'busy'))
    const { saver, seen } = queued()
    saver.set('one')
    await saver.flush()
    expect(seen.at(-1)).toBe('error')
    expect(entry()).toMatchObject({ state: 'retry', body: { bio: 'one' } })
    saver.set('two')
    await saver.flush()
    expect(seen.at(-1)).toBe('saved')
    expect(entry()).toBeUndefined()
  })

  test('after dispose with a failing save the entry is still in the store', async () => {
    sender.mockRejectedValue(new ApiError(0, 'network'))
    const { saver } = queued()
    saver.set('late')
    saver.dispose()
    await flushPromises()
    expect(entry()).toMatchObject({ state: 'retry' })
  })

  test('a refused save (400) marks the entry refused with the error code', async () => {
    sender.mockRejectedValue(new ApiError(400, 'Invalid postcode'))
    const { saver, seen } = queued()
    saver.set('x')
    await saver.flush()
    expect(seen.at(-1)).toBe('error')
    expect(entry()).toMatchObject({ state: 'refused', reason: 'Invalid postcode' })
  })

  test('a value set and the app killed before the 600 ms wait is in the store', () => {
    const { saver } = queued()
    saver.set('typed')
    expect(entry()).toMatchObject({ body: { bio: 'typed' }, accountId: 'a' })
    expect(sender).not.toHaveBeenCalled()
  })

  test('the saver never calls save itself, and requests for one key never overlap', async () => {
    let open = 0
    let max = 0
    sender.mockImplementation(async () => {
      max = Math.max(max, ++open)
      await Promise.resolve()
      await Promise.resolve()
      open--
    })
    const { saver, save } = queued()
    saver.set('a')
    saver.flush()
    await flushPromises()
    saver.set('ab')
    await saver.flush()
    expect(save).not.toHaveBeenCalled()
    expect(sender).toHaveBeenCalledTimes(2)
    expect(max).toBe(1)
  })

  test('a value that has no body removes the entry and counts as saved', async () => {
    const { saver, seen } = queued()
    saver.set('x')
    saver.set('')
    expect(entry()).toBeUndefined()
    await saver.flush()
    expect(sender).not.toHaveBeenCalled()
    expect(seen.at(-1)).toBe('saved')
  })

  test('a service renamed from tmp to its real id is still sent under the new key', async () => {
    let q = { ...queue, key: 'service:tmp:1:bio', kind: 'service-field' as const, serviceRef: 'tmp:1' }
    registerSender('service-field', sender)
    const seen: SaveStatus[] = []
    const saver = createFieldSaver(jest.fn(), 600, (x) => seen.push(x), () => q)
    saver.set('v')
    replaceServiceRef('tmp:1', 'real')
    q = { ...q, key: 'service:real:bio', serviceRef: 'real' }
    await saver.flush()
    expect(sender).toHaveBeenCalledWith(expect.objectContaining({ key: 'service:real:bio', serviceRef: 'real' }))
    expect(listEntries('a')).toEqual([])
  })

  test('without an account nothing is put and the status is error', async () => {
    const seen: SaveStatus[] = []
    const saver = createFieldSaver(jest.fn(), 600, (x) => seen.push(x), () => ({ ...queue, accountId: '' }))
    saver.set('x')
    await saver.flush()
    expect(listEntries()).toEqual([])
    expect(sender).not.toHaveBeenCalled()
    expect(seen.at(-1)).toBe('error')
  })
})
