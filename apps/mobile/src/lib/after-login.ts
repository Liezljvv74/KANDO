import * as SecureStore from 'expo-secure-store'

/** Where to go once the person is signed in: the search page, or the provider page they were looking at when they had to log in or sign up.
 * Kept on the phone, so it survives closing the app while waiting for the email code. */
const KEY = 'kando.afterLogin'

const MAX_AGE_MS = 2 * 60 * 60 * 1000 // a forgotten tap must not redirect a login days later

export type AfterLogin = '/search' | `/provider/${string}`

/** Only the search page or a provider page with a plain slug: a stored value is never trusted as a route. */
export const isAfterLogin = (v: string): v is AfterLogin => v === '/search' || /^\/provider\/[a-z0-9-]{1,80}$/.test(v)

export const setAfterLogin = async (t: AfterLogin | null) => {
  try {
    if (t) await SecureStore.setItemAsync(KEY, `${t}|${Date.now()}`)
    else await SecureStore.deleteItemAsync(KEY)
  } catch {
    // the person simply lands on Home
  }
}

/** The target once, then cleared. */
export async function consumeAfterLogin(): Promise<AfterLogin | null> {
  try {
    const v = await SecureStore.getItemAsync(KEY)
    if (!v) return null
    await SecureStore.deleteItemAsync(KEY)
    const [target, at] = v.split('|')
    return target !== undefined && isAfterLogin(target) && Date.now() - Number(at) < MAX_AGE_MS ? target : null
  } catch {
    return null
  }
}

/** Where a person goes after the email code: a customer to the stored target or the search page; null when the offering flow (a provider setup) decides. */
export const afterVerifyTarget = (offerServices: boolean, stored: AfterLogin | null): AfterLogin | null => (offerServices ? null : (stored ?? '/search'))
