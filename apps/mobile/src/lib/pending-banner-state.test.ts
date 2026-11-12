import type { PendingEntry } from '@/lib/pending-saves'
import { bannerState, discardPlan, shouldClearGone } from '@/lib/pending-banner-state'

const e = (o: Partial<PendingEntry> = {}): PendingEntry => ({
  key: 'k', kind: 'about', accountId: 'a', body: {}, route: '/r', field: 'f', version: 1, state: 'retry', attempts: 1, createdAt: 1, ...o,
})

describe('shouldClearGone', () => {
  it('keeps a notice on the first render and when the account is unchanged', () => {
    expect(shouldClearGone(undefined, 'a')).toBe(false)
    expect(shouldClearGone('a', 'a')).toBe(false)
  })
  it('clears when the account changes', () => {
    expect(shouldClearGone('a', null)).toBe(true)
    expect(shouldClearGone(null, 'b')).toBe(true)
  })
})

describe('discardPlan', () => {
  const create = e({ key: 'c', kind: 'service-create', serviceRef: 'tmp:1', state: 'refused' })
  const field = e({ key: 'f', kind: 'service-field', serviceRef: 'tmp:1' })
  const other = e({ key: 'o', kind: 'service-field', serviceRef: 'tmp:2' })
  it('a single refused entry removes only itself', () => expect(discardPlan(e({ key: 'x', state: 'refused' }), [e({ key: 'x' })])).toEqual(['x']))
  it('a refused service-create takes its field entries along', () => expect(discardPlan(create, [create, field, other])).toEqual(['c', 'f']))
  it('a refused field entry removes only its key', () => expect(discardPlan({ ...field, state: 'refused' }, [create, field, other])).toEqual(['f']))
})

describe('bannerState', () => {
  it('is null when nothing is pending', () => expect(bannerState([], 'a')).toBeNull())
  it('says network for status 0', () => expect(bannerState([e({ status: 0 })], 'a')).toEqual({ kind: 'retry', reason: 'network' }))
  it('says busy for a 503', () => expect(bannerState([e({ status: 503 })], 'a')).toEqual({ kind: 'retry', reason: 'busy' }))
  it('says auth and waiting', () => {
    expect(bannerState([e({ state: 'auth' })], 'a')).toEqual({ kind: 'retry', reason: 'auth' })
    expect(bannerState([e({ state: 'waiting' })], 'a')).toEqual({ kind: 'retry', reason: 'waiting' })
  })
  it('auth and waiting win over a plain retry entry', () => {
    expect(bannerState([e({ status: 503 }), e({ key: 'x', state: 'auth' })], 'a')).toEqual({ kind: 'retry', reason: 'auth' })
    expect(bannerState([e({ status: 0 }), e({ key: 'x', state: 'waiting' })], 'a')).toEqual({ kind: 'retry', reason: 'waiting' })
  })
  it('refused wins over retry', () => {
    const r = e({ key: 'r', state: 'refused' })
    expect(bannerState([e(), r], 'a')).toEqual({ kind: 'refused', count: 1, first: r })
  })
  it('two refused: count 2, the older first', () => {
    const old = e({ key: 'old', state: 'refused', createdAt: 1 })
    const young = e({ key: 'young', state: 'refused', createdAt: 5 })
    expect(bannerState([young, old], 'a')).toEqual({ kind: 'refused', count: 2, first: old })
  })
  it('ignores another account', () => expect(bannerState([e({ accountId: 'b' })], 'a')).toBeNull())
  it('is null without an account', () => expect(bannerState([e()], null)).toBeNull())
})
