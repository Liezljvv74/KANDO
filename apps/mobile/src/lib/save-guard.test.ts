import { createSaveGuard, freshOr } from './save-guard'

test('a load that started before a save cannot overwrite the saved answer', () => {
  const g = createSaveGuard<string>()
  const fresh = g.start() // the reload starts
  g.saved('saved: consent on') // a save answers meanwhile
  expect(freshOr('loaded: consent off', fresh(), g.latest())).toBe('saved: consent on')
})

test('a load that started after the save shows its own answer', () => {
  const g = createSaveGuard<string>()
  g.saved('saved')
  const fresh = g.start()
  expect(freshOr('loaded', fresh(), g.latest())).toBe('loaded')
})

test('without any save a load always shows its answer', () => {
  const g = createSaveGuard<string>()
  const fresh = g.start()
  expect(freshOr('loaded', fresh(), g.latest())).toBe('loaded')
})
