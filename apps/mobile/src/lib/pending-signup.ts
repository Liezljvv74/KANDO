import type { Address } from '@kando/contract'
import * as SecureStore from 'expo-secure-store'

const KEY = 'skilled.pendingSignup'

/** What the sign-up form collected that can only be saved once the email code is confirmed (the server refuses an unconfirmed session). The password is never stored. */
export type PendingSignup = {
  firstName: string
  lastName: string
  offerServices: boolean
  pictureUri: string | null
  address: Address | null
}

export const savePending = (p: PendingSignup) => SecureStore.setItemAsync(KEY, JSON.stringify(p))
export const clearPending = () => SecureStore.deleteItemAsync(KEY)

export async function loadPending(): Promise<PendingSignup | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY)
    return raw ? (JSON.parse(raw) as PendingSignup) : null
  } catch {
    return null
  }
}
