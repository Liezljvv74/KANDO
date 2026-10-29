import { toMinutes, toStartAt } from './booking-time'

jest.mock('@/i18n', () => ({ getLang: () => 'en' }))

test('a real local date and time becomes the matching instant', () => {
  expect(toStartAt('2027-01-05', '09:30')).toBe(new Date(2027, 0, 5, 9, 30).toISOString())
  expect(toStartAt(' 2027-01-05 ', ' 09:30 ')).not.toBeNull()
})

test('wrong formats and impossible dates or times are rejected', () => {
  for (const [d, t] of [['5.1.2027', '09:30'], ['2027-01-05', '9:30'], ['2027-02-31', '09:00'], ['2027-01-05', '25:00'], ['', '']]) expect(toStartAt(d!, t!)).toBeNull()
})

test('minutes must be a whole number', () => {
  expect(toMinutes(' 90 ')).toBe(90)
  for (const s of ['', '1.5', '-5', 'abc']) expect(toMinutes(s)).toBeNull()
})
