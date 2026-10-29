import { describe, expect, it } from 'vitest'
import { emailDateTime } from './notifications'

describe('emailDateTime', () => {
  it('shows date and time in Berlin time, German and English', () => {
    const d = new Date('2026-11-12T03:00:00Z') // 04:00 in Berlin (winter)
    expect(emailDateTime(d, 'de')).toBe('12.11.2026, 04:00')
    expect(emailDateTime(d, 'en')).toBe('12/11/2026, 04:00')
  })
  it('keeps the time of a 6-hour short-notice window', () => {
    const d = new Date(new Date('2026-07-01T08:30:00Z').getTime() + 6 * 3_600_000) // 16:30 Berlin (summer)
    expect(emailDateTime(d, 'de')).toBe('01.07.2026, 16:30')
  })
})
