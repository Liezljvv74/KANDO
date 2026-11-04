const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}))
import { consumeAfterLogin, setAfterLogin } from './after-login'

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
})
