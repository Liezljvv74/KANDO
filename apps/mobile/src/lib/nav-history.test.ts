import { backFrom, canGoForward, forwardTo, hrefOf, noteRoute, resetNavHistory } from './nav-history'

beforeEach(() => resetNavHistory())

describe('hrefOf', () => {
  it('a plain path stays as it is', () => expect(hrefOf('/search', {})).toBe('/search'))
  it('query values are added, a value already in the path (a dynamic segment) is not', () => {
    expect(hrefOf('/provider/anna', { slug: 'anna' })).toBe('/provider/anna')
    expect(hrefOf('/bookings/new-request', { providerId: 'p1', remote: '1' })).toBe('/bookings/new-request?providerId=p1&remote=1')
  })
  it('an array value or an undefined one is left out', () => expect(hrefOf('/x', { a: ['1', '2'], b: undefined as unknown as string })).toBe('/x'))
})

describe('forward history (like a browser: Back remembers where you were)', () => {
  it('nothing to go forward to at the start', () => expect(canGoForward()).toBe(false))
  it('Back remembers the page left; Forward returns to it once', () => {
    noteRoute('/jobs') // the person is on Jobs
    expect(backFrom()).toBe(true)
    noteRoute('/search') // the route change the Back made
    expect(canGoForward()).toBe(true)
    expect(forwardTo()).toBe('/jobs')
    noteRoute('/jobs') // the route change the Forward made
    expect(canGoForward()).toBe(false)
    expect(forwardTo()).toBeNull()
  })
  it('several Backs can be undone in order', () => {
    noteRoute('/c')
    backFrom()
    noteRoute('/b')
    backFrom()
    noteRoute('/a')
    expect(forwardTo()).toBe('/b')
    noteRoute('/b')
    expect(forwardTo()).toBe('/c')
  })
  it('any other navigation clears Forward, however soon after an arrow it comes', () => {
    noteRoute('/jobs')
    backFrom()
    noteRoute('/search')
    noteRoute('/account') // the person tapped a tab at once: not Back, not Forward
    expect(canGoForward()).toBe(false)
  })
  it('a slow route change after an arrow still counts as the arrow (no clock)', () => {
    jest.useFakeTimers()
    noteRoute('/jobs')
    backFrom()
    jest.advanceTimersByTime(60_000)
    noteRoute('/search')
    expect(canGoForward()).toBe(true)
    jest.useRealTimers()
  })
  it('a double tap is one move: the second press is ignored until the first has landed', () => {
    noteRoute('/jobs')
    expect(backFrom()).toBe(true)
    expect(backFrom()).toBe(false)
    noteRoute('/search')
    expect(forwardTo()).toBe('/jobs')
    expect(forwardTo()).toBeNull() // the Forward is still on its way
  })
})
