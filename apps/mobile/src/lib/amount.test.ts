import { parseAmount, parseAmountOrZero } from './amount'

test('plain amounts with a comma or dot decimal parse', () => {
  expect(parseAmount('90')).toBe(90)
  expect(parseAmount(' 12,5 ')).toBe(12.5)
  expect(parseAmount('1250.50')).toBe(1250.5)
})

test('exponents, thousands separators, extra decimals, zero and text are rejected', () => {
  for (const s of ['1e3', '1.250,50', '1,250.50', '12.345', '0', '0,00', '-5', 'abc', '', '1,']) expect(parseAmount(s)).toBeNull()
})

test('an amount that may be nothing (a stop amount, a material part) also takes 0', () => {
  for (const zero of ['0', '0,00', '0.0', ' 00 ']) expect(parseAmountOrZero(zero)).toBe(0)
  expect(parseAmountOrZero('12,5')).toBe(12.5)
  for (const bad of ['', '-1', '0,001', 'abc']) expect(parseAmountOrZero(bad)).toBeNull()
})
