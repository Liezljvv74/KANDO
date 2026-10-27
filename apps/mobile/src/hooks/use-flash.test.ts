import { createFlash } from './use-flash'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

test('createFlash: on after show, off after the delay, off at once on hide, a second show restarts the delay', () => {
  const seen: boolean[] = []
  const f = createFlash((on) => seen.push(on), 3000)
  f.show()
  jest.advanceTimersByTime(2000)
  f.show()
  jest.advanceTimersByTime(2000)
  expect(seen).toEqual([true, true]) // restarted: still on 4 s after the first show
  jest.advanceTimersByTime(1000)
  expect(seen).toEqual([true, true, false])
  f.show()
  f.hide()
  jest.advanceTimersByTime(5000)
  expect(seen).toEqual([true, true, false, true, false]) // hide switched it off; the timer did not fire again
})

test('createFlash: show is a no-op after dispose', () => {
  const seen: boolean[] = []
  const f = createFlash((on) => seen.push(on), 3000)
  f.dispose()
  f.show()
  jest.advanceTimersByTime(5000)
  expect(seen).toEqual([])
})

test('createFlash: a fresh flash after a dispose works again (remount)', () => {
  const seen: boolean[] = []
  createFlash(() => {}, 3000).dispose()
  createFlash((on) => seen.push(on), 3000).show()
  expect(seen).toEqual([true])
})
