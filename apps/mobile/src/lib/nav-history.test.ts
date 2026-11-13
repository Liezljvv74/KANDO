import { canGoForward, forwardTo, hrefOf, noteRoute, resetNavHistory } from './nav-history'

beforeEach(() => resetNavHistory())
const visit = (...hrefs: string[]) => hrefs.forEach(noteRoute)

describe('hrefOf', () => {
  it('a plain path stays as it is', () => expect(hrefOf('/search', {})).toBe('/search'))
  it('query values are added; the value of a dynamic segment is left out by its name', () => {
    expect(hrefOf('/provider/anna', { slug: 'anna' }, ['(tabs)', 'provider', '[slug]'])).toBe('/provider/anna')
    expect(hrefOf('/bookings/new-request', { providerId: 'p1', remote: '1' }, ['(tabs)', 'bookings', 'new-request'])).toBe('/bookings/new-request?providerId=p1&remote=1')
  })
  it('a query value that happens to equal a path segment is kept, and so is an empty one', () => {
    expect(hrefOf('/bookings/request/12', { id: '12', booking: '12' }, ['bookings', 'request', '[id]'])).toBe('/bookings/request/12?booking=12')
    expect(hrefOf('/verify-email', { email: '' }, ['(auth)', 'verify-email'])).toBe('/verify-email?email=')
  })
  it('a catch-all segment is left out by its name; an array value or an undefined one too', () => {
    expect(hrefOf('/docs/a', { rest: 'a', x: '1' }, ['docs', '[...rest]'])).toBe('/docs/a?x=1')
    expect(hrefOf('/x', { a: ['1', '2'], b: undefined })).toBe('/x')
  })
})

describe('forward history (like a browser: going back remembers where you were)', () => {
  it('nothing to go forward to at the start, or after pages are only opened', () => {
    expect(canGoForward()).toBe(false)
    visit('/search', '/jobs')
    expect(canGoForward()).toBe(false)
  })
  it('going back remembers the page left, however it was done (arrow, Android button, swipe); Forward returns to it once', () => {
    visit('/search', '/jobs', '/search') // the last one is the step back
    expect(canGoForward()).toBe(true)
    expect(forwardTo()).toBe('/jobs')
    noteRoute('/jobs') // the route change the Forward made
    expect(canGoForward()).toBe(false)
    expect(forwardTo()).toBeNull()
  })
  it('several steps back can be undone in order', () => {
    visit('/a', '/b', '/c', '/b', '/a')
    expect(forwardTo()).toBe('/b')
    noteRoute('/b')
    expect(forwardTo()).toBe('/c')
    noteRoute('/c')
    expect(canGoForward()).toBe(false)
  })
  it('after Forward, Back and Forward keep working', () => {
    visit('/a', '/b', '/a')
    forwardTo()
    visit('/b', '/a')
    expect(forwardTo()).toBe('/b')
  })
  it('any new page clears Forward', () => {
    visit('/search', '/jobs', '/search', '/account')
    expect(canGoForward()).toBe(false)
  })
  it('a page opened on top of itself and closed again changes nothing: the arrows never freeze', () => {
    visit('/search', '/threads/1', '/search') // back: Forward is /threads/1
    visit('/search') // the same address again
    expect(forwardTo()).toBe('/threads/1')
  })
  it('a double tap on Forward is one move', () => {
    visit('/a', '/b', '/c', '/b', '/a')
    expect(forwardTo()).toBe('/b')
    expect(forwardTo()).toBeNull() // the first is still on its way
    noteRoute('/b')
    expect(forwardTo()).toBe('/c')
  })
  it('a step back over several pages (a replaced page in between) remembers only the page left', () => {
    visit('/a', '/b', '/c', '/a')
    expect(forwardTo()).toBe('/c')
    noteRoute('/c')
    expect(canGoForward()).toBe(false)
  })
})
