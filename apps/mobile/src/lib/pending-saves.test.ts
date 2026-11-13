/* eslint-disable @typescript-eslint/no-require-imports -- modules are reloaded per test to simulate an app restart */
const mockDisk: Record<string, string> = {}
let mockReadGate: Promise<void> | null = null
let mockReadThrows = false
const mockMoves: { from: string; to: string }[] = []
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
      if (mockReadGate) await mockReadGate
      if (mockReadThrows) throw new Error('EIO')
      return mockDisk[this.name]
    }
    async write(s: string) {
      mockDisk[this.name] = s
    }
    async move(to: File) {
      mockMoves.push({ from: this.name, to: to.name })
      mockDisk[to.name] = mockDisk[this.name]
      delete mockDisk[this.name]
    }
  }
  return { File, Paths: { document: {} } }
})

type Store = typeof import('./pending-saves')
let s: Store
let ApiError: typeof import('@/api/client').ApiError
const tick = () => new Promise((r) => setTimeout(r, 0))
const base = { kind: 'about' as const, accountId: 'a', body: { x: 1 }, route: '/r', field: 'f' }
const put = (key: string, over: Partial<Parameters<Store['putEntry']>[0]> = {}) => s.putEntry({ ...base, key, ...over })

beforeEach(() => {
  for (const k of Object.keys(mockDisk)) delete mockDisk[k]
  mockMoves.length = 0
  mockReadGate = null
  mockReadThrows = false
  jest.resetModules()
  s = require('./pending-saves')
  ApiError = require('@/api/client').ApiError
})

describe('pending-saves', () => {
  it('keeps one entry per key and raises the version', () => {
    const v1 = put('k')
    const v2 = put('k')
    expect(v2).toBeGreaterThan(v1)
    expect(s.listEntries()).toHaveLength(1)
  })

  it('clearIfVersion only clears the newest version', () => {
    const v1 = put('k')
    const v2 = put('k')
    s.clearIfVersion('k', v1)
    expect(s.listEntries()).toHaveLength(1)
    s.clearIfVersion('k', v2)
    expect(s.listEntries()).toHaveLength(0)
  })

  it('classifies failures', () => {
    const c = (n: number) => s.classifyFailure(new ApiError(n, 'x'))
    expect([400, 404].map(c)).toEqual(['refused', 'refused'])
    expect(c(401)).toBe('auth')
    expect([403, 428].map(c)).toEqual(['waiting', 'waiting'])
    expect([0, 408, 429, 503].map(c)).toEqual(['retry', 'retry', 'retry', 'retry'])
    expect(s.classifyFailure(new Error('network'))).toBe('retry')
  })

  it('markFailed sets state, reason, status, attempts and field', () => {
    const v = put('k')
    s.markFailed('k', v, new ApiError(400, 'Invalid postcode'), 'postcode')
    const [e] = s.listEntries()
    expect(e).toMatchObject({ state: 'refused', reason: 'Invalid postcode', status: 400, attempts: 1, field: 'postcode' })
    s.markFailed('k', v, new ApiError(503, 'busy'))
    expect(s.listEntries()[0]).toMatchObject({ state: 'retry', attempts: 2, status: 503 })
  })

  it('markFailed ignores an older version', () => {
    const v1 = put('k')
    put('k')
    s.markFailed('k', v1, new ApiError(400, 'x'))
    expect(s.listEntries()[0].attempts).toBe(0)
  })

  it('dropAccount leaves other accounts', () => {
    put('k1', { accountId: 'a' })
    put('k2', { accountId: 'b' })
    s.dropAccount('a')
    expect(s.listEntries().map((e) => e.key)).toEqual(['k2'])
    expect(s.listEntries('b')).toHaveLength(1)
    expect(s.listEntries('a')).toHaveLength(0)
  })

  it('dropService removes only that service entries', () => {
    put('service-create:tmp:1', { kind: 'service-create', serviceRef: 'tmp:1' })
    put('service:tmp:1:title', { kind: 'service-field', serviceRef: 'tmp:1' })
    put('service:s2:title', { kind: 'service-field', serviceRef: 's2' })
    put('other')
    s.dropService('tmp:1')
    expect(s.listEntries().map((e) => e.key)).toEqual(['service:s2:title', 'other'])
  })

  it('removeKey and replaceServiceRef', () => {
    put('service:tmp:1:name', { kind: 'service-field', serviceRef: 'tmp:1' })
    put('other')
    s.replaceServiceRef('tmp:1', 'real-id')
    expect(s.listEntries().map((e) => [e.key, e.serviceRef])).toEqual([
      ['service:real-id:name', 'real-id'],
      ['other', undefined],
    ])
    s.removeKey('other', 'a')
    expect(s.listEntries()).toHaveLength(1)
  })

  it('survives a restart', async () => {
    await s.loadStore()
    put('k')
    await tick()
    await tick()
    jest.resetModules()
    s = require('./pending-saves')
    expect(s.listEntries()).toHaveLength(0)
    await s.loadStore()
    expect(s.listEntries().map((e) => e.key)).toEqual(['k'])
  })

  it('writes a temporary file, then moves it over the real one', async () => {
    await s.loadStore()
    put('k')
    await tick()
    await tick()
    expect(mockMoves).toEqual([{ from: 'pending-saves.json.tmp', to: 'pending-saves.json' }])
    expect(JSON.parse(mockDisk['pending-saves.json'])).toHaveLength(1)
  })

  it('an invalid file gives an empty store', async () => {
    mockDisk['pending-saves.json'] = '{not json'
    await expect(s.loadStore()).resolves.toBeUndefined()
    expect(s.listEntries()).toEqual([])
  })

  it('a missing file gives an empty store', async () => {
    await s.loadStore()
    expect(s.listEntries()).toEqual([])
  })

  it('an entry put before the load finishes survives it', async () => {
    mockDisk['pending-saves.json'] = JSON.stringify([
      { ...base, key: 'old', version: 1, state: 'retry', attempts: 0, createdAt: Date.now() },
      { ...base, key: 'k', body: { x: 'file' }, version: 1, state: 'retry', attempts: 0, createdAt: Date.now() },
    ])
    const loading = s.loadStore()
    put('k', { body: { x: 'new' } })
    await loading
    const byKey = Object.fromEntries(s.listEntries().map((e) => [e.key, e.body]))
    expect(byKey).toEqual({ old: { x: 1 }, k: { x: 'new' } })
  })

  it('drops entries older than 7 days on load', async () => {
    const day = 86_400_000
    mockDisk['pending-saves.json'] = JSON.stringify([
      { ...base, key: 'stale', version: 1, state: 'retry', attempts: 0, createdAt: Date.now() - 8 * day },
      { ...base, key: 'fresh', version: 2, state: 'retry', attempts: 0, createdAt: Date.now() - 6 * day },
    ])
    await s.loadStore()
    expect(s.listEntries().map((e) => e.key)).toEqual(['fresh'])
  })

  const old = (key: string, over = {}) => ({ ...base, key, version: 1, state: 'retry', attempts: 0, createdAt: Date.now(), ...over })
  const keysOnDisk = () => JSON.parse(mockDisk['pending-saves.json']).map((e: { key: string }) => e.key).sort()

  it('does not write over the file before the load has read it', async () => {
    mockDisk['pending-saves.json'] = JSON.stringify([old('old')])
    let release = () => {}
    mockReadGate = new Promise<void>((r) => (release = r))
    const loading = s.loadStore()
    put('new')
    await tick()
    await tick()
    expect(keysOnDisk()).toEqual(['old'])
    release()
    await loading
    await tick()
    await tick()
    expect(keysOnDisk()).toEqual(['new', 'old'])
  })

  it('skips the next write when an existing file could not be read', async () => {
    const raw = JSON.stringify([old('old')])
    mockDisk['pending-saves.json'] = raw
    mockReadThrows = true
    await s.loadStore()
    put('new')
    await tick()
    await tick()
    expect(mockDisk['pending-saves.json']).toBe(raw)
  })

  it('a dropAccount before the load is not undone by the merge', async () => {
    mockDisk['pending-saves.json'] = JSON.stringify([old('k1', { accountId: 'a' }), old('k2', { accountId: 'b' })])
    s.dropAccount('a')
    await s.loadStore()
    expect(s.listEntries().map((e) => e.key)).toEqual(['k2'])
  })

  it('removeKey and clearIfVersion before the load are not undone by the merge', async () => {
    mockDisk['pending-saves.json'] = JSON.stringify([old('k1'), old('k2'), old('k3')])
    s.removeKey('k1', 'a')
    const v = put('k2')
    s.clearIfVersion('k2', v)
    await s.loadStore()
    expect(s.listEntries().map((e) => e.key)).toEqual(['k3'])
  })

  it('drops invalid entries on load', async () => {
    mockDisk['pending-saves.json'] = JSON.stringify([
      old('ok'),
      old('badkind', { kind: 'zzz' }),
      old('badstate', { state: 'zzz' }),
      old('noroute', { route: 5 }),
      old('nofield', { field: undefined }),
      null,
    ])
    await s.loadStore()
    expect(s.listEntries().map((e) => e.key)).toEqual(['ok'])
  })

  it('replaceServiceRef points a new-service route at the created service', () => {
    put('service:tmp:1:title', { kind: 'service-field', serviceRef: 'tmp:1', route: '/my-profile/service/new' })
    put('service:s2:title', { kind: 'service-field', serviceRef: 's2', route: '/my-profile/service/s2' })
    s.replaceServiceRef('tmp:1', 's1')
    put('service:tmp:1:price', { kind: 'service-field', serviceRef: 'tmp:1', route: '/my-profile/service/new' })
    expect(s.listEntries().map((e) => [e.key, e.route])).toEqual([
      ['service:s1:title', '/my-profile/service/s1'],
      ['service:s2:title', '/my-profile/service/s2'],
      ['service:s1:price', '/my-profile/service/s1'],
    ])
  })

  it('replaceServiceRef treats $ in the id literally', () => {
    put('service:tmp:1:name', { kind: 'service-field', serviceRef: 'tmp:1' })
    s.replaceServiceRef('tmp:1', 'a$&b')
    expect(s.listEntries()[0].key).toBe('service:a$&b:name')
  })

  it('forAccount keeps only that account', () => {
    put('k1', { accountId: 'a' })
    put('k2', { accountId: 'b' })
    expect(s.forAccount(s.listEntries(), 'a').map((e) => e.key)).toEqual(['k1'])
    expect(s.forAccount(s.listEntries(), null)).toEqual([])
  })

  it('two accounts with the same key keep both entries; one account never touches the other', async () => {
    await s.loadStore()
    const va = put('about:street', { accountId: 'a', body: 'A street' })
    const vb = put('about:street', { accountId: 'b', body: 'B street' })
    expect(s.listEntries('a').map((e) => e.body)).toEqual(['A street'])
    expect(s.listEntries('b').map((e) => e.body)).toEqual(['B street'])
    expect(s.findEntry(s.listEntries(), 'about:street', 'b')?.body).toBe('B street')
    expect(s.findEntry(s.listEntries(), 'about:street', 'c')).toBeUndefined()
    expect(s.findEntry(s.listEntries(), 'about:street', null)).toBeUndefined()
    s.markFailed('about:street', vb, new ApiError(400, 'x'))
    expect(s.listEntries('a')[0].state).toBe('retry')
    s.clearIfVersion('about:street', va)
    expect(s.listEntries().map((e) => e.accountId)).toEqual(['b'])
    put('about:street', { accountId: 'a', body: 'A again' })
    s.removeKey('about:street', 'b')
    expect(s.listEntries().map((e) => e.body)).toEqual(['A again'])
    put('about:street', { accountId: 'b', body: 'B again' })
    await tick()
    await tick()
    jest.resetModules()
    s = require('./pending-saves')
    await s.loadStore()
    expect(s.listEntries().map((e) => [e.accountId, e.body]).sort()).toEqual([
      ['a', 'A again'],
      ['b', 'B again'],
    ])
  })

  it('notifies subscribers on every change and lists one account', () => {
    const fn = jest.fn()
    const off = s.subscribe(fn)
    put('k1', { accountId: 'a' })
    put('k2', { accountId: 'b' })
    s.removeKey('k2', 'b')
    expect(fn).toHaveBeenCalledTimes(3)
    expect(s.listEntries('a').map((e) => e.key)).toEqual(['k1'])
    off()
    put('k3')
    expect(fn).toHaveBeenCalledTimes(3)
  })
})
