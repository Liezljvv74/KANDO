/* eslint-disable @typescript-eslint/no-require-imports -- modules are reloaded per test */
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

type Store = typeof import('./pending-saves')
type Runner = typeof import('./pending-runner')
let s: Store
let r: Runner
let ApiError: typeof import('@/api/client').ApiError
let appStateHandler: (st: string) => void
let account: string | null
let stops: (() => void)[]
let removeSub: jest.Mock

const base = { kind: 'about' as const, accountId: 'a', body: { x: 1 }, route: '/r', field: 'f' }
const put = (key: string, over: Partial<Parameters<Store['putEntry']>[0]> = {}) => s.putEntry({ ...base, key, ...over })
const ms = (n: number) => jest.advanceTimersByTimeAsync(n)
const start = async (opts?: Parameters<Runner['startRunner']>[1]) => {
  stops.push(r.startRunner(() => account, opts))
  await ms(0)
}

beforeEach(() => {
  jest.useFakeTimers()
  for (const k of Object.keys(mockDisk)) delete mockDisk[k]
  jest.resetModules()
  const rn = require('react-native')
  jest.spyOn(rn.AppState, 'addEventListener').mockImplementation(((_: string, fn: (st: string) => void) => {
    appStateHandler = fn
    return { remove: removeSub }
  }) as never)
  removeSub = jest.fn()
  s = require('./pending-saves')
  r = require('./pending-runner')
  ApiError = require('@/api/client').ApiError
  account = 'a'
  stops = []
})

afterEach(() => {
  stops.forEach((fn) => fn())
  jest.useRealTimers()
})

describe('pending-runner', () => {
  it('retries a retryable failure after 2, 5, 15, 45 s, then every 60 s', async () => {
    const send = jest.fn().mockRejectedValue(new ApiError(503, 'busy'))
    r.registerSender('about', send)
    put('k')
    await start()
    expect(send).toHaveBeenCalledTimes(1)
    await ms(1999)
    expect(send).toHaveBeenCalledTimes(1)
    await ms(1)
    expect(send).toHaveBeenCalledTimes(2)
    await ms(5000)
    expect(send).toHaveBeenCalledTimes(3)
    await ms(15000)
    expect(send).toHaveBeenCalledTimes(4)
    await ms(45000)
    expect(send).toHaveBeenCalledTimes(5)
    await ms(59999)
    expect(send).toHaveBeenCalledTimes(5)
    await ms(1)
    expect(send).toHaveBeenCalledTimes(6)
    await ms(60000)
    expect(send).toHaveBeenCalledTimes(7)
  })

  it('stores the field a sender names for a refused entry', async () => {
    r.registerSender('about', jest.fn().mockRejectedValue(new ApiError(400, 'Invalid postcode')), () => 'postcode')
    put('k')
    await start()
    expect(s.listEntries().find((x) => x.key === 'k')).toMatchObject({ state: 'refused', field: 'postcode' })
  })

  it('forgets an earlier fieldFor when a sender is registered without one', async () => {
    r.registerSender('about', jest.fn().mockRejectedValue(new ApiError(400, 'bad')), () => 'postcode')
    r.registerSender('about', jest.fn().mockRejectedValue(new ApiError(400, 'bad')))
    put('k')
    await start()
    expect(s.listEntries().find((x) => x.key === 'k')?.field).not.toBe('postcode')
  })

  it('stops retrying a refused entry until it is replaced', async () => {
    const send = jest.fn().mockRejectedValue(new ApiError(400, 'bad'))
    r.registerSender('about', send)
    put('k')
    await start()
    expect(s.listEntries()[0].state).toBe('refused')
    await ms(200000)
    appStateHandler('active')
    await ms(0)
    expect(send).toHaveBeenCalledTimes(1)
    send.mockResolvedValue(undefined)
    put('k')
    appStateHandler('active')
    await ms(0)
    expect(send).toHaveBeenCalledTimes(2)
    expect(s.listEntries()).toHaveLength(0)
  })

  it('an auth entry waits and is sent at once on wake() after sign-in', async () => {
    const send = jest.fn().mockResolvedValue(undefined)
    r.registerSender('about', send)
    put('k', { accountId: 'b' })
    account = null
    await start()
    expect(send).not.toHaveBeenCalled()
    account = 'b'
    r.wake()
    await ms(0)
    expect(send).toHaveBeenCalledTimes(1)
    expect(s.listEntries()).toHaveLength(0)
  })

  it('an auth failure is not retried by the timer, only on wake or foreground', async () => {
    const send = jest.fn().mockRejectedValueOnce(new ApiError(401, 'auth')).mockResolvedValue(undefined)
    r.registerSender('about', send)
    put('k')
    await start()
    await ms(120000)
    expect(send).toHaveBeenCalledTimes(1)
    r.wake()
    await ms(0)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('never sends an entry of another account', async () => {
    const send = jest.fn().mockResolvedValue(undefined)
    r.registerSender('about', send)
    put('k', { accountId: 'other' })
    await start()
    appStateHandler('active')
    await ms(0)
    expect(send).not.toHaveBeenCalled()
    expect(await r.sendNow('k')).toBe('ok') // nothing of this account to send under that key
    expect(await r.sendNow('k', 'other')).toBe('failed')
    expect(send).not.toHaveBeenCalled()
    expect(s.listEntries()).toHaveLength(1)
  })

  it('an entry of another account with the same key is neither sent nor removed; this account sends its own', async () => {
    const send = jest.fn().mockResolvedValue(undefined)
    r.registerSender('about', send)
    put('about:street', { accountId: 'other', body: 'theirs' })
    await start()
    put('about:street', { body: 'mine' })
    expect(await r.sendNow('about:street')).toBe('ok')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toMatchObject({ accountId: 'a', body: 'mine' })
    expect(s.listEntries().map((e) => [e.accountId, e.body])).toEqual([['other', 'theirs']])
  })

  it('sends entries of one serviceRef in the order they were put', async () => {
    const order: string[] = []
    r.registerSender('service-create', async (e) => void order.push(e.key))
    r.registerSender('service-field', async (e) => void order.push(e.key))
    put('create', { kind: 'service-create', serviceRef: 'tmp:1' })
    put('f1', { kind: 'service-field', serviceRef: 'tmp:1' })
    put('f2', { kind: 'service-field', serviceRef: 'tmp:1' })
    await start()
    expect(order).toEqual(['create', 'f1', 'f2'])
  })

  it('does not send a field while its create is still failing', async () => {
    const field = jest.fn().mockResolvedValue(undefined)
    r.registerSender('service-create', jest.fn().mockRejectedValue(new ApiError(503, 'busy')))
    r.registerSender('service-field', field)
    put('create', { kind: 'service-create', serviceRef: 'tmp:1' })
    put('f1', { kind: 'service-field', serviceRef: 'tmp:1' })
    await start()
    await ms(2000)
    expect(field).not.toHaveBeenCalled()
  })

  it('a success clears only the newest version; a newer value put during the send is sent next', async () => {
    const bodies: unknown[] = []
    let release: () => void = () => {}
    const send = jest.fn(async (e: { body: unknown }) => {
      bodies.push(e.body)
      if (bodies.length === 1) await new Promise<void>((res) => (release = res))
    })
    r.registerSender('about', send)
    put('k', { body: 1 })
    await start()
    put('k', { body: 2 })
    release()
    await ms(0)
    expect(bodies).toEqual([1, 2])
    expect(s.listEntries()).toHaveLength(0)
  })

  it('two sendNow calls for one key never overlap', async () => {
    let active = 0
    let max = 0
    r.registerSender('about', async () => {
      active++
      max = Math.max(max, active)
      await new Promise((res) => setTimeout(res, 100))
      active--
    })
    put('k')
    await s.loadStore()
    stops.push(r.startRunner(() => account))
    const p = Promise.all([r.sendNow('k'), r.sendNow('k')])
    await ms(300)
    await p
    expect(max).toBe(1)
  })

  it('a never-answering send for one service does not stop another service', async () => {
    const done: string[] = []
    r.registerSender('service-field', async (e) => {
      if (e.serviceRef === 's1') return new Promise<void>(() => {})
      done.push(e.key)
    })
    put('a1', { kind: 'service-field', serviceRef: 's1' })
    put('b1', { kind: 'service-field', serviceRef: 's2' })
    await start()
    expect(done).toEqual(['b1'])
    await ms(30000)
    expect(s.listEntries()[0].state).toBe('retry')
    expect(s.listEntries()[0].status).toBe(0)
  })

  it('a 404 on a service entry drops that service entries and reports it', async () => {
    const gone = jest.fn()
    r.registerSender('service-field', async (e) => {
      throw new ApiError(e.serviceRef === 's1' ? 404 : 503, 'x')
    })
    put('f1', { kind: 'service-field', serviceRef: 's1' })
    put('f2', { kind: 'service-field', serviceRef: 's1' })
    put('f3', { kind: 'service-field', serviceRef: 's2' })
    await start({ onServiceGone: gone })
    expect(gone).toHaveBeenCalledWith('s1')
    expect(s.listEntries().map((e) => e.key)).not.toContain('f1')
    expect(s.listEntries().map((e) => e.key)).not.toContain('f2')
    expect(s.listEntries().map((e) => e.key)).toEqual(['f3'])
  })

  it('an entry whose kind has no sender is left alone', async () => {
    put('k')
    await start()
    expect(s.listEntries()[0].attempts).toBe(0)
    expect(await r.sendNow('k')).toBe('failed')
  })

  it('retries waiting entries on foreground', async () => {
    const send = jest.fn().mockRejectedValueOnce(new ApiError(403, 'terms')).mockResolvedValue(undefined)
    r.registerSender('about', send)
    put('k')
    await start()
    await ms(100000)
    expect(send).toHaveBeenCalledTimes(1)
    appStateHandler('active')
    await ms(0)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('sendNow sends nothing when the runner is not started or has stopped', async () => {
    const send = jest.fn().mockRejectedValue(new ApiError(503, 'busy'))
    r.registerSender('about', send)
    put('k')
    expect(await r.sendNow('k')).toBe('failed')
    expect(send).not.toHaveBeenCalled()
    await start()
    stops.pop()!()
    expect(await r.sendNow('k')).toBe('failed')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('a value put during a failing send is sent next, with a real schedule', async () => {
    const bodies: unknown[] = []
    r.registerSender('about', async (e) => {
      bodies.push(e.body)
      if (bodies.length === 1) {
        put('k', { body: 2 })
        throw new ApiError(503, 'busy')
      }
    })
    put('k', { body: 1 })
    await start()
    expect(bodies).toEqual([1, 2])
    expect(s.listEntries()).toHaveLength(0)
  })

  it('a throwing onServiceGone does not block later sendNow for that key', async () => {
    const send = jest.fn().mockRejectedValueOnce(new ApiError(404, 'nf')).mockResolvedValue(undefined)
    r.registerSender('service-field', send)
    put('f1', { kind: 'service-field', serviceRef: 's1' })
    await start({
      onServiceGone: () => {
        throw new Error('boom')
      },
    })
    put('f1', { kind: 'service-field', serviceRef: 's1' })
    expect(await r.sendNow('f1')).toBe('ok')
  })

  it('sendNow leaves a field alone while its service-create is unsent', async () => {
    const field = jest.fn().mockResolvedValue(undefined)
    r.registerSender('service-field', field)
    r.registerSender('service-create', jest.fn().mockResolvedValue(undefined))
    put('create', { kind: 'service-create', serviceRef: 'tmp:1' })
    put('f1', { kind: 'service-field', serviceRef: 'tmp:1' })
    await s.loadStore()
    stops.push(r.startRunner(() => account))
    expect(await r.sendNow('f1')).toBe('failed')
    expect(field).not.toHaveBeenCalled()
    expect(s.listEntries().find((e) => e.key === 'f1')?.attempts).toBe(0)
  })

  it('stop clears pending timers, removes the AppState subscription and ignores a late failure', async () => {
    let fail: () => void = () => {}
    const send = jest.fn(() => new Promise<void>((_, rej) => (fail = () => rej(new ApiError(503, 'busy')))))
    r.registerSender('about', send)
    put('k')
    await start()
    stops.pop()!()
    expect(removeSub).toHaveBeenCalled()
    fail()
    await ms(100000)
    expect(send).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  describe('service-create', () => {
    const CREATE = 'service-create:tmp:1'
    let api: { list: jest.Mock; create: jest.Mock; update: jest.Mock; remove: jest.Mock }
    let fieldRefs: (string | undefined)[]
    const putCreate = (categoryId: string, known: string[] = []) =>
      put(CREATE, { kind: 'service-create', serviceRef: 'tmp:1', body: { categoryId, known }, route: '/my-profile/service/new', field: 'category' })
    const putField = (f: string) => put(`service:tmp:1:${f}`, { kind: 'service-field', serviceRef: 'tmp:1', body: { [f]: 'x' } })
    const creates = () => s.listEntries().filter((e) => e.kind === 'service-create')

    beforeEach(() => {
      api = { list: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({ id: 's1', category: 'c1' }), update: jest.fn().mockResolvedValue({ id: 's1' }), remove: jest.fn().mockResolvedValue(undefined) }
      fieldRefs = []
      r.registerSender('service-create', require('./serial-create').serviceCreateSender(api))
      r.registerSender('service-field', async (e) => {
        if (e.serviceRef?.startsWith('tmp:')) throw new ApiError(0, 'tmp')
        fieldRefs.push(e.serviceRef)
      })
    })

    it('sends the create first, then the fields typed before it with the real id (never tmp:)', async () => {
      putCreate('c1')
      putField('title')
      putField('price')
      await start()
      expect(api.create).toHaveBeenCalledWith({ categoryId: 'c1' })
      expect(api.list).not.toHaveBeenCalled()
      expect(fieldRefs).toEqual(['s1', 's1'])
      expect(s.listEntries()).toHaveLength(0)
      expect(require('./serial-create').createdService('tmp:1')).toMatchObject({ id: 's1' })
    })

    it('a failed create keeps the fields waiting and unsent', async () => {
      api.create.mockRejectedValue(new ApiError(503, 'busy'))
      putCreate('c1')
      putField('title')
      await start()
      await ms(7000)
      expect(api.create).toHaveBeenCalledTimes(3)
      expect(fieldRefs).toEqual([])
      expect(s.listEntries().find((e) => e.kind === 'service-field')).toMatchObject({ serviceRef: 'tmp:1', attempts: 0 })
    })

    it('before resending, takes over a service of that category the phone does not know, without a second POST', async () => {
      api.create.mockRejectedValueOnce(new ApiError(0, 'lost'))
      api.list.mockResolvedValue([
        { id: 'old', category: 'c1' },
        { id: 's9', category: 'c1' },
      ])
      putCreate('c1', ['old'])
      putField('title')
      await start()
      expect(api.create).toHaveBeenCalledTimes(1)
      expect(api.list).not.toHaveBeenCalled()
      await ms(2000)
      expect(api.list).toHaveBeenCalledTimes(1)
      expect(api.create).toHaveBeenCalledTimes(1)
      expect(fieldRefs).toEqual(['s9'])
      expect(s.listEntries()).toHaveLength(0)
    })

    it('two category changes before the create succeeds leave one create entry with the newest category', async () => {
      api.create.mockRejectedValueOnce(new ApiError(503, 'busy'))
      putCreate('c1')
      await start()
      putCreate('c2')
      expect(creates()).toHaveLength(1)
      expect(creates()[0].body).toMatchObject({ categoryId: 'c2' })
      await r.sendNow(CREATE)
      expect(api.create).toHaveBeenLastCalledWith({ categoryId: 'c2' })
      expect(creates()).toHaveLength(0)
    })

    it('a refused create holds the fields; choosing another category releases them', async () => {
      api.create.mockRejectedValueOnce(new ApiError(400, 'bad category'))
      putCreate('c1')
      putField('title')
      await start()
      expect(creates()[0]).toMatchObject({ state: 'refused', route: '/my-profile/service/new', field: 'category' })
      expect(fieldRefs).toEqual([])
      putCreate('c2')
      r.wake()
      await ms(0)
      expect(fieldRefs).toEqual(['s1'])
      expect(s.listEntries()).toHaveLength(0)
    })

    it('a category chosen again while the create is in flight updates the new service', async () => {
      let answer: (v: unknown) => void = () => {}
      api.create.mockReturnValueOnce(new Promise((res) => (answer = res)))
      putCreate('c1')
      await start()
      putCreate('c2')
      answer({ id: 's1', category: 'c1' })
      await ms(0)
      expect(api.create).toHaveBeenCalledTimes(1)
      expect(api.update).toHaveBeenCalledWith('s1', { categoryId: 'c2' })
      expect(s.listEntries()).toHaveLength(0)
    })

    it('after a restart, a create kept from before is checked with a list first (the app may have died mid-POST)', async () => {
      mockDisk['pending-saves.json'] = JSON.stringify([
        { key: CREATE, kind: 'service-create', accountId: 'a', body: { categoryId: 'c1', known: [] }, serviceRef: 'tmp:1', route: '/my-profile/service/new', field: 'category', version: 1, state: 'retry', attempts: 0, createdAt: Date.now() - 1000 },
      ])
      api.list.mockResolvedValue([{ id: 's9', category: 'c1' }])
      await start()
      expect(api.list).toHaveBeenCalledTimes(1)
      expect(api.create).not.toHaveBeenCalled()
      expect(s.listEntries()).toHaveLength(0)
    })

    it('a category changed after a lost answer takes over the service of the earlier category and updates it', async () => {
      api.create.mockRejectedValueOnce(new ApiError(0, 'lost'))
      api.list.mockResolvedValue([{ id: 's9', category: 'c1' }])
      api.update.mockImplementation(async (id: string, b: { categoryId: string }) => ({ id, category: b.categoryId }))
      putCreate('c1')
      putField('title')
      await start()
      const sc = require('./serial-create')
      put(CREATE, { kind: 'service-create', serviceRef: 'tmp:1', body: sc.createBody(s.listEntries().find((e) => e.key === CREATE), 'c2', []), route: '/my-profile/service/new', field: 'category' })
      await r.sendNow(CREATE)
      expect(api.create).toHaveBeenCalledTimes(1)
      expect(api.update).toHaveBeenCalledWith('s9', { categoryId: 'c2' })
      await ms(0)
      expect(fieldRefs).toEqual(['s9'])
    })

    it('createBody keeps the categories tried before', () => {
      const sc = require('./serial-create')
      expect(sc.createBody(undefined, 'c1', ['k'])).toEqual({ categoryId: 'c1', known: ['k'], tried: [] })
      expect(sc.createBody({ body: { categoryId: 'c2', tried: ['c1'] } }, 'c3', [])).toEqual({ categoryId: 'c3', known: [], tried: ['c1', 'c2'] })
    })

    it('refusedCreate finds the refused create of that account, so a new-service screen can show it', async () => {
      api.create.mockRejectedValueOnce(new ApiError(400, 'bad'))
      putCreate('c1')
      await start()
      const sc = require('./serial-create')
      expect(sc.refusedCreate('a')).toMatchObject({ serviceRef: 'tmp:1', body: { categoryId: 'c1' } })
      expect(sc.refusedCreate('b')).toBeUndefined()
    })

    it('a value put under a temporary id that was already created goes under the real id', async () => {
      putCreate('c1')
      await start()
      putField('title')
      putCreate('c2')
      expect(s.listEntries().map((e) => [e.key, e.serviceRef])).toEqual([
        ['service:s1:title', 's1'],
        [CREATE, 's1'],
      ])
      await r.sendNow(CREATE)
      expect(api.create).toHaveBeenCalledTimes(1)
      expect(api.update).toHaveBeenCalledWith('s1', { categoryId: 'c2' })
    })

    it('a service deleted on the phone while its create is in flight is removed again on the server', async () => {
      let answer: (v: unknown) => void = () => {}
      api.create.mockReturnValueOnce(new Promise((res) => (answer = res)))
      putCreate('c1')
      putField('title')
      await start()
      s.dropService('tmp:1')
      answer({ id: 's1', category: 'c1' })
      await ms(0)
      expect(api.remove).toHaveBeenCalledWith('s1')
      expect(fieldRefs).toEqual([])
      expect(s.listEntries()).toHaveLength(0)
    })
  })
})
