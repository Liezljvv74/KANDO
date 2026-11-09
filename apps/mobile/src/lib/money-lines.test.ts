import type { Booking } from '@kando/contract'

import { moneyLines } from './money-lines'

jest.mock('@/i18n', () => ({ t: (key: string, p?: Record<string, string | number>) => `${key}${p ? JSON.stringify(p) : ''}` }))

const bk = (total: number, rate = 0.15, status = 'confirmed') => ({ status, money: { total, commission: Math.round(total * rate * 100) / 100, net: Math.round(total * (1 - rate) * 100) / 100, rate } }) as unknown as Booking

test('moneyLines sums a job with one additional task', () => {
  const lines = moneyLines(bk(100), [bk(20)])
  expect(lines.map((l) => l.amount)).toEqual([100, 20, 120, -18, 102])
  expect(lines[3]!.label).toContain('"rate":15')
})

test('before payment the last line is marked expected, and a booking without money has no lines', () => {
  expect(moneyLines(bk(100, 0.15, 'awaiting-payment'), []).at(-1)!.label).toBe('money.line.receiveExpected')
  expect(moneyLines({ status: 'confirmed' } as Booking, [])).toEqual([])
})

test('a task paid at another rate leaves the percentage out of the commission label', () => {
  const lines = moneyLines(bk(100, 0.12), [bk(20, 0.15)])
  expect(lines[3]!.label).toBe('money.line.commissionMixed')
  expect(lines[3]!.amount).toBe(-15)
})
