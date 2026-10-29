import { nearBottom } from './scroll'

const view = (offsetY: number) => ({ contentHeight: 2000, viewHeight: 600, offsetY })

test('at the end or within the slack counts as near the bottom', () => {
  expect(nearBottom(view(1400))).toBe(true)
  expect(nearBottom(view(1400 - 79))).toBe(true)
})

test('reading older messages is not near the bottom', () => {
  expect(nearBottom(view(0))).toBe(false)
  expect(nearBottom(view(1400 - 200))).toBe(false)
})

test('a list shorter than the screen is always at the bottom', () => {
  expect(nearBottom({ contentHeight: 300, viewHeight: 600, offsetY: 0 })).toBe(true)
})
