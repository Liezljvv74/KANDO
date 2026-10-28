import { flushPendingTags, registerPendingTags } from './pending-tags'

test('flushPendingTags runs every registered flusher and waits for it', async () => {
  const done: string[] = []
  const off = registerPendingTags(async () => {
    await Promise.resolve()
    done.push('skills')
  })
  const off2 = registerPendingTags(async () => void done.push('strengths'))
  await flushPendingTags()
  expect(done.sort()).toEqual(['skills', 'strengths'])
  off()
  off2()
})

test('a removed flusher is not run, and a failing one does not stop the others', async () => {
  const gone = jest.fn(async () => {})
  const ok = jest.fn(async () => {})
  registerPendingTags(gone)()
  const off = registerPendingTags(async () => {
    throw new Error('offline')
  })
  const off2 = registerPendingTags(ok)
  await expect(flushPendingTags()).resolves.toBeUndefined()
  expect(gone).not.toHaveBeenCalled()
  expect(ok).toHaveBeenCalledTimes(1)
  off()
  off2()
})
