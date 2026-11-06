import { gateHeading, gateRows, quoteBlocked } from './quote-gate'

describe('quote gate', () => {
  it('blocks only when a step is missing', () => {
    expect(quoteBlocked(undefined)).toBe(false)
    expect(quoteBlocked([])).toBe(false)
    expect(quoteBlocked(['consent'])).toBe(true)
  })
  it('uses the singular heading for one step', () => {
    expect(gateHeading(1)).toBe('quoteGate.headingOne')
    expect(gateHeading(2)).toBe('quoteGate.headingMany')
  })
  it('has a row per step in the given order, the tax row without a hint', () => {
    expect(gateRows(['payout', 'taxId']).map((r) => [r.step, r.title, r.hint])).toEqual([
      ['payout', 'quoteGate.payout', 'quoteGate.payoutHint'],
      ['taxId', 'quoteGate.taxId', undefined],
    ])
  })
})
