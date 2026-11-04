import { fromIsoDay, toIsoDay } from './birth-date'

test('a day round-trips through the phone date and back', () => {
  for (const s of ['1990-05-17', '2000-02-29', '1985-12-31', '2001-01-01']) expect(toIsoDay(fromIsoDay(s)!)).toBe(s)
})

test('what is not a real day gives null', () => {
  for (const s of ['1990-02-31', '17.05.1990', '', null, undefined, '1990-5-7']) expect(fromIsoDay(s as never)).toBeNull()
})

test('the day does not move near midnight', () => {
  expect(toIsoDay(new Date(2024, 2, 31, 0, 30))).toBe('2024-03-31')
  expect(toIsoDay(new Date(2024, 2, 31, 23, 30))).toBe('2024-03-31')
})
