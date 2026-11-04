import * as SecureStore from 'expo-secure-store'

/** Where to go once the person is signed in: "I need help" tapped while signed out leads to the search page after login or sign-up.
 * Kept on the phone, so it survives closing the app while waiting for the email code. */
const KEY = 'kando.afterLogin'

const MAX_AGE_MS = 2 * 60 * 60 * 1000 // a forgotten tap must not redirect a login days later

export const setAfterLogin = async (t: '/search' | null) => {
  try {
    if (t) await SecureStore.setItemAsync(KEY, `${t}|${Date.now()}`)
    else await SecureStore.deleteItemAsync(KEY)
  } catch {
    // the person simply lands on Home
  }
}

/** The target once, then cleared. */
export async function consumeAfterLogin(): Promise<'/search' | null> {
  try {
    const v = await SecureStore.getItemAsync(KEY)
    if (!v) return null
    await SecureStore.deleteItemAsync(KEY)
    const [target, at] = v.split('|')
    return target === '/search' && Date.now() - Number(at) < MAX_AGE_MS ? target : null
  } catch {
    return null
  }
}
