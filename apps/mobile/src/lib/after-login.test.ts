const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
import { afterVerifyTarget, consumeAfterLogin, isAfterLogin, setAfterLogin } from './after-login'

describe('after login', () => {
  beforeEach(() => mockStore.clear())
  it('gives the target once', async () => {
    await setAfterLogin('/search')
    expect(await consumeAfterLogin()).toBe('/search')
    expect(await consumeAfterLogin()).toBeNull()
  })
  it('can be cleared by another choice', async () => {
    await setAfterLogin('/search')
    await setAfterLogin(null)
    expect(await consumeAfterLogin()).toBeNull()
  })
  it('keeps a provider page for after the login', async () => {
    await setAfterLogin('/provider/anna-schmidt')
    expect(await consumeAfterLogin()).toBe('/provider/anna-schmidt')
  })
  it('forgets a target older than 2 hours', async () => {
    mockStore.set('kando.afterLogin', `/provider/anna|${Date.now() - 3 * 60 * 60 * 1000}`)
    expect(await consumeAfterLogin()).toBeNull()
  })
  it('ignores a stored target that is not allowed', async () => {
    mockStore.set('kando.afterLogin', `/bookings/b1|${Date.now()}`)
    expect(await consumeAfterLogin()).toBeNull()
  })
})

describe('isAfterLogin', () => {
  it('accepts the search page and a provider page with a plain slug', () => {
    expect(isAfterLogin('/search')).toBe(true)
    expect(isAfterLogin('/provider/anna-schmidt')).toBe(true)
  })
  it('accepts the private tabs that ask for a login, so the person is back on that tab afterwards', () => {
    for (const v of ['/jobs', '/my-profile', '/account']) expect(isAfterLogin(v)).toBe(true)
  })
  it('refuses anything else', () => {
    for (const v of ['/provider/../x', '/provider/', '/provider/A B', 'https://evil.example', '/bookings/b1', '/admin', '', '/provider/a/b']) expect(isAfterLogin(v)).toBe(false)
  })
})

describe('afterVerifyTarget (a new customer lands on Search, not Home)', () => {
  it('a customer with nothing stored goes to Search', () => expect(afterVerifyTarget(false, null)).toBe('/search'))
  it('a customer with a stored provider page goes there', () => expect(afterVerifyTarget(false, '/provider/anna')).toBe('/provider/anna'))
  it('a customer who signed up from the Jobs prompt is back on Jobs; My business is not there for a customer, so Search', () => {
    expect(afterVerifyTarget(false, '/jobs')).toBe('/jobs')
    expect(afterVerifyTarget(false, '/my-profile')).toBe('/search')
  })
  it('a person who offers services is led by the offering flow', () => {
    expect(afterVerifyTarget(true, null)).toBeNull()
    expect(afterVerifyTarget(true, '/search')).toBeNull()
  })
})
