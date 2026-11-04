import { consumeAfterLogin, setAfterLogin } from './after-login'

describe('after login', () => {
  it('gives the target once', () => {
    setAfterLogin('/search')
    expect(consumeAfterLogin()).toBe('/search')
    expect(consumeAfterLogin()).toBeNull()
  })
  it('can be cleared by another choice', () => {
    setAfterLogin('/search')
    setAfterLogin(null)
    expect(consumeAfterLogin()).toBeNull()
  })
})
