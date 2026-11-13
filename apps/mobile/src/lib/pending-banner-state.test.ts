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
  it('a single refused entry removes only itself', () => expect(discardPlan(e({ key: 'x', state: 'refused' }), [e({ key: 'x', state: 'refused' })])).toEqual(['x']))
  it('a refused service-create takes its field entries along', () => expect(discardPlan(create, [create, field, other])).toEqual(['c', 'f']))
  it('another account with the same serviceRef is left alone', () => {
    const foreign = e({ key: 'z', accountId: 'b', serviceRef: 'tmp:1' })
    expect(discardPlan(create, [create, foreign])).toEqual(['c'])
  })
  it('an entry edited again meanwhile (new version) or gone is kept', () => {
    expect(discardPlan(create, [{ ...create, version: 2, state: 'retry' }, field])).toEqual([])
    expect(discardPlan(create, [field])).toEqual([])
  })
  it('a refused field entry removes only its key', () => expect(discardPlan({ ...field, state: 'refused' }, [create, field, other])).toEqual(['f']))
})

describe('bannerState', () => {
  it('is null when nothing is pending', () => expect(bannerState([], 'a')).toBeNull())
  it('says network for status 0', () => expect(bannerState([e({ status: 0 })], 'a')).toEqual({ kind: 'retry', reason: 'network' }))
  it('says busy for a 503', () => expect(bannerState([e({ status: 503 })], 'a')).toEqual({ kind: 'retry', reason: 'busy' }))
  it('says auth and waiting', () => {
    const auth = e({ state: 'auth' })
    const waiting = e({ state: 'waiting' })
    expect(bannerState([auth], 'a')).toEqual({ kind: 'retry', reason: 'auth', first: auth }) // `first`: it can be discarded
    expect(bannerState([waiting], 'a')).toEqual({ kind: 'retry', reason: 'waiting', first: waiting })
  })
  it('auth and waiting win over a plain retry entry', () => {
    expect(bannerState([e({ status: 503 }), e({ key: 'x', state: 'auth' })], 'a')).toMatchObject({ kind: 'retry', reason: 'auth' })
    expect(bannerState([e({ status: 0 }), e({ key: 'x', state: 'waiting' })], 'a')).toMatchObject({ kind: 'retry', reason: 'waiting' })
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
  it('shows nothing for a change that is only on its way (never failed): no flashing while typing', () =>
    expect(bannerState([e({ attempts: 0 })], 'a')).toBeNull())
  it('keeps showing while a failed change is typed on (attempts start again, the failure is remembered)', () =>
    expect(bannerState([e({ attempts: 0, status: 0 })], 'a')).toEqual({ kind: 'retry', reason: 'network' }))
  it('ignores another account', () => expect(bannerState([e({ accountId: 'b' })], 'a')).toBeNull())
  it('is null without an account', () => expect(bannerState([e()], null)).toBeNull())
})
