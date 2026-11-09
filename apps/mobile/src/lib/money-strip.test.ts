import { stripCells } from './money-strip'

const fmt = (n: number, c: string) => `${c} ${n}`

test('the strip formats every amount in the currency it carries', () => {
  const cells = stripCells({ receivedThisMonth: 10, onItsWay: 20, onHold: 0, currency: 'ZAR' }, fmt)
  expect(cells!.map(([, shown]) => shown)).toEqual(['ZAR 10', 'ZAR 20', 'ZAR 0'])
})

test('without data or without a currency nothing is shown and the formatter is not called', () => {
  const never = jest.fn(fmt)
  expect(stripCells(undefined, never)).toBeNull()
  expect(stripCells({ receivedThisMonth: 1, onItsWay: 1, onHold: 1 } as never, never)).toBeNull()
  expect(never).not.toHaveBeenCalled()
})
