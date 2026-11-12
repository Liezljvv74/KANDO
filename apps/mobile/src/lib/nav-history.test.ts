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
    backFrom('/jobs')
    noteRoute('/search') // the route change the Back made
    expect(canGoForward()).toBe(true)
    expect(forwardTo()).toBe('/jobs')
    noteRoute('/jobs') // the route change the Forward made
    expect(canGoForward()).toBe(false)
    expect(forwardTo()).toBeNull()
  })
  it('several Backs can be undone in order', () => {
    backFrom('/c')
    noteRoute('/b')
    backFrom('/b')
    noteRoute('/a')
    expect(forwardTo()).toBe('/b')
    noteRoute('/b')
    expect(forwardTo()).toBe('/c')
  })
  it('any other navigation clears Forward', () => {
    backFrom('/jobs')
    noteRoute('/search')
    noteRoute('/account') // the person tapped a tab: not Back, not Forward
    expect(canGoForward()).toBe(false)
  })
})
