import { parseAmount } from './amount'

test('plain amounts with a comma or dot decimal parse', () => {
  expect(parseAmount('90')).toBe(90)
  expect(parseAmount(' 12,5 ')).toBe(12.5)
  expect(parseAmount('1250.50')).toBe(1250.5)
})

test('exponents, thousands separators, extra decimals, zero and text are rejected', () => {
  for (const s of ['1e3', '1.250,50', '1,250.50', '12.345', '0', '0,00', '-5', 'abc', '', '1,']) expect(parseAmount(s)).toBeNull()
})
