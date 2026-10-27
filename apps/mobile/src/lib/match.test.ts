import { matches } from './match'

test('matches ignores case and accents, and an empty query matches everything', () => {
  expect(matches('Küche & Haushalt', 'kuche')).toBe(true)
  expect(matches('Küche & Haushalt', 'HAUS')).toBe(true)
  expect(matches('Babysitting', 'dog')).toBe(false)
  expect(matches('Babysitting', '  ')).toBe(true)
})
