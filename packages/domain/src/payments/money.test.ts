import { describe, expect, it } from 'vitest'

import { bookingMoney, youReceive } from './money'
import { COMMISSION_RATE } from './rules'

describe('youReceive', () => {
  it('120.00 at 0.15 is 102.00', () => expect(youReceive(120, 0.15)).toBe(102))
})

describe('bookingMoney', () => {
  it('before payment (no stored rate) uses the current rate', () => expect(bookingMoney(100, null).rate).toBe(COMMISSION_RATE))
  it('a stored rate wins over the constant', () => expect(bookingMoney(100, '0.1200')).toEqual({ total: 100, commission: 12, net: 88, rate: 0.12 }))
})
