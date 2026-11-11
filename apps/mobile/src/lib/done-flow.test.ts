import type { NextStep } from './next-step'
import { createOnce, runDone } from './done-flow'

const step: NextStep = { kind: 'about', path: '/my-profile/about' }
const base = { isProvider: true, wasOpen: true, missing: () => [], commit: async () => true }

test('missing fields: no commit', async () => {
  const commit = jest.fn(async () => true)
  expect(await runDone({ ...base, missing: () => ['s.price'], commit, loadNext: async () => step })).toEqual({ type: 'missing', fields: ['s.price'] })
  expect(commit).not.toHaveBeenCalled()
})
test('commit false: failed', async () => {
  expect(await runDone({ ...base, commit: async () => false, loadNext: async () => step })).toEqual({ type: 'failed' })
})
test('nothing open at focus or after: edit', async () => {
  expect(await runDone({ ...base, wasOpen: false, loadNext: async () => null })).toEqual({ type: 'edit' })
})
test('next after: next', async () => {
  expect(await runDone({ ...base, wasOpen: true, loadNext: async () => step })).toEqual({ type: 'next', step })
  expect(await runDone({ ...base, wasOpen: false, loadNext: async () => step })).toEqual({ type: 'next', step })
})
test('open at focus, nothing after: end', async () => {
  expect(await runDone({ ...base, wasOpen: true, loadNext: async () => null })).toEqual({ type: 'end', role: 'provider' })
  expect(await runDone({ ...base, wasOpen: true, isProvider: false, loadNext: async () => null })).toEqual({ type: 'end', role: 'customer' })
})
test('open at focus and the look after the save throws: edit', async () => {
  expect(await runDone({ ...base, wasOpen: true, loadNext: () => Promise.reject(new Error('x')) })).toEqual({ type: 'edit' })
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
