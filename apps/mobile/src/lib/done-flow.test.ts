import type { NextStep } from './next-step'
import { createOnce, runDone } from './done-flow'

const step: NextStep = { kind: 'about', path: '/my-profile/about' }
const base = { isProvider: true, missing: () => [], commit: async () => true }

test('missing fields: no commit', async () => {
  const commit = jest.fn(async () => true)
  expect(await runDone({ ...base, missing: () => ['s.price'], commit, loadNext: async () => step })).toEqual({ type: 'missing', fields: ['s.price'] })
  expect(commit).not.toHaveBeenCalled()
})
test('commit false: failed', async () => {
  expect(await runDone({ ...base, commit: async () => false, loadNext: async () => step })).toEqual({ type: 'failed' })
})
test('nothing open before or after: edit', async () => {
  expect(await runDone({ ...base, loadNext: async () => null })).toEqual({ type: 'edit' })
})
test('open before, next after: next', async () => {
  expect(await runDone({ ...base, loadNext: async () => step })).toEqual({ type: 'next', step })
})
test('open before, nothing after: end', async () => {
  const seq = [step, null]
  expect(await runDone({ ...base, loadNext: async () => seq.shift() ?? null })).toEqual({ type: 'end', role: 'provider' })
  const seq2 = [step, null]
  expect(await runDone({ ...base, isProvider: false, loadNext: async () => seq2.shift() ?? null })).toEqual({ type: 'end', role: 'customer' })
})
test('loadNext throws after a good commit: edit', async () => {
  const seq = [step]
  expect(await runDone({ ...base, loadNext: async () => seq.shift() ?? Promise.reject(new Error('x')) })).toEqual({ type: 'edit' })
})
test('loadNext throws before the save: treated as flow', async () => {
  let n = 0
  expect(await runDone({ ...base, loadNext: async () => (n++ ? null : Promise.reject(new Error('x'))) })).toEqual({ type: 'end', role: 'provider' })
})
test('createOnce ignores a second call while the first runs', async () => {
  const fn = jest.fn(() => new Promise<void>((r) => setTimeout(r, 10)))
  const once = createOnce(fn)
  await Promise.all([once(), once()])
  expect(fn).toHaveBeenCalledTimes(1)
  await once()
  expect(fn).toHaveBeenCalledTimes(2)
})

test('commit that rejects: failed', async () => {
  expect(await runDone({ ...base, commit: () => Promise.reject(new Error('x')), loadNext: async () => step })).toEqual({ type: 'failed' })
})
