import { buildProposal, buildQuoteTime, emptyWhenWhere, suggestedWhen, whenFromRequest, withDay, withTimeOfDay } from './when-where'

// a fixed 'now', so the tests do not depend on today's date
const NOW = new Date(2026, 11, 1, 12, 0, 0, 0)
const build = (v: Parameters<typeof buildProposal>[0], o: Parameters<typeof buildProposal>[1], now = NOW) => buildProposal(v, o, now)
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0)
const filled = (over: Partial<ReturnType<typeof emptyWhenWhere>> = {}) => ({ ...emptyWhenWhere({ street: ' Hauptstr. 1 ', postcode: ' 10115 ', city: ' Berlin ' }), when: at(2027, 1, 5, 9, 30), ...over })

describe('suggestedWhen, withDay, withTimeOfDay', () => {
  it('opens tomorrow at 09:00', () => {
    expect(suggestedWhen(at(2026, 12, 31, 15, 0))).toEqual(at(2027, 1, 1, 9, 0))
  })

  it('choosing a day keeps the time of day, and starts at 09:00 when none was chosen', () => {
    expect(withDay(at(2027, 1, 5, 14, 15), at(2027, 2, 1, 3, 0))).toEqual(at(2027, 2, 1, 14, 15))
    expect(withDay(null, at(2027, 2, 1, 3, 0))).toEqual(at(2027, 2, 1, 9, 0))
  })

  it('choosing a time keeps the day, and uses tomorrow when none was chosen', () => {
    expect(withTimeOfDay(at(2027, 1, 5, 14, 15), at(2000, 1, 1, 8, 5))).toEqual(at(2027, 1, 5, 8, 5))
    expect(withTimeOfDay(null, at(2000, 1, 1, 8, 5)).getHours()).toBe(8)
  })

  it('does not change the date it was given', () => {
    const base = at(2027, 1, 5, 14, 15)
    withTimeOfDay(base, at(2000, 1, 1, 8, 5))
    withDay(base, at(2027, 3, 1, 1, 1))
    expect(base).toEqual(at(2027, 1, 5, 14, 15))
  })
})

describe('buildProposal', () => {
  it('needs a start and a whole-number duration', () => {
    expect(build(filled({ when: null }), { canRemote: true, withDetails: true })).toEqual({ ok: false, error: 'invalid-time' })
    expect(build(filled({ duration: 'abc' }), { canRemote: true, withDetails: true })).toEqual({ ok: false, error: 'invalid-time' })
    expect(build(filled({ duration: '' }), { canRemote: true, withDetails: true })).toEqual({ ok: false, error: 'invalid-time' })
  })

  it('sends start, duration, place, trimmed address and note for an on-site request', () => {
    const r = build(filled({ note: '  Please bring a ladder ', duration: '90' }), { canRemote: true, withDetails: true })
    expect(r).toEqual({
      ok: true,
      proposal: { startAt: at(2027, 1, 5, 9, 30).toISOString(), durationMin: 90, onSite: true, address: { postcode: '10115', street: 'Hauptstr. 1', city: 'Berlin' }, note: 'Please bring a ladder' },
    })
  })

  it('a start in the past is refused, also a past time of today', () => {
    expect(build(filled(), { canRemote: true, withDetails: true }, at(2027, 1, 5, 9, 31))).toEqual({ ok: false, error: 'start-in-past' })
    expect(build(filled(), { canRemote: true, withDetails: true }, at(2027, 1, 5, 9, 30))).toEqual({ ok: false, error: 'start-in-past' })
    expect(build(filled(), { canRemote: true, withDetails: true }, at(2027, 1, 5, 9, 29))).toMatchObject({ ok: true })
  })

  it('an on-site job with details needs at least the postcode', () => {
    const noPostcode = filled({ address: { street: 'Hauptstr. 1', postcode: ' ', city: '' } })
    expect(build(noPostcode, { canRemote: true, withDetails: true })).toEqual({ ok: false, error: 'address-required' })
    expect(build(noPostcode, { canRemote: false, withDetails: true })).toEqual({ ok: false, error: 'address-required' }) // cannot choose remote: always on site
  })

  it('a remote job sends no address; street and city stay out when empty', () => {
    const remote = build(filled({ onSite: false, note: 'x' }), { canRemote: true, withDetails: true })
    expect(remote).toEqual({ ok: true, proposal: { startAt: at(2027, 1, 5, 9, 30).toISOString(), durationMin: 60, onSite: false, note: 'x' } })
    const postcodeOnly = build(filled({ address: { street: '', postcode: '10115', city: '' } }), { canRemote: true, withDetails: true })
    expect(postcodeOnly).toMatchObject({ ok: true, proposal: { address: { postcode: '10115' } } })
    expect((postcodeOnly as { proposal: { address: object } }).proposal.address).toEqual({ postcode: '10115' })
  })

  it('without details (a counter or an entered time) there is no address and no note, and the postcode is not needed', () => {
    const r = build(filled({ address: { street: '', postcode: '', city: '' }, note: 'x' }), { canRemote: true, withDetails: false })
    expect(r).toEqual({ ok: true, proposal: { startAt: at(2027, 1, 5, 9, 30).toISOString(), durationMin: 60, onSite: true } })
  })
})

describe('whenFromRequest, buildQuoteTime', () => {
  const asked = { startAt: at(2027, 1, 5, 9, 30).toISOString(), durationMin: 90 }

  it('the answer starts from the time the customer asked for, and is empty for a request without one', () => {
    expect(whenFromRequest(asked)).toMatchObject({ when: at(2027, 1, 5, 9, 30), duration: '90' })
    expect(whenFromRequest({ startAt: null, durationMin: null }).when).toBeNull()
  })

  it('a quote without a confirmed time carries none, whatever the fields hold', () => {
    expect(buildQuoteTime(emptyWhenWhere(), false, NOW)).toEqual({ ok: true, time: null })
  })

  it('a confirmed time is checked like any other: needed, and in the future', () => {
    expect(buildQuoteTime(whenFromRequest(asked), true, NOW)).toEqual({ ok: true, time: { startAt: asked.startAt, durationMin: 90 } })
    expect(buildQuoteTime(emptyWhenWhere(), true, NOW)).toEqual({ ok: false, error: 'invalid-time' })
    expect(buildQuoteTime(whenFromRequest(asked), true, at(2027, 1, 6))).toEqual({ ok: false, error: 'start-in-past' })
  })
})
