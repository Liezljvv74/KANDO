import type { Address } from '@kando/contract'
import * as SecureStore from 'expo-secure-store'

const KEY = 'skilled.pendingSignup'

/** What the sign-up form collected that can only be saved once the email code is confirmed (the server refuses an unconfirmed session). The password is never stored. */
export type PendingSignup = {
  /** Lower-cased: the record only applies to the account it was made for. */
  email: string
  /** Gone once the names and address are saved, so a retry never overwrites later edits. */
  firstName?: string
  lastName?: string
  offerServices: boolean
  /** The Terms box was ticked; saved with the account once the code is confirmed. */
  termsAccepted?: boolean
  pictureUri: string | null
  address?: Address | null
}

/** What is still to do after a step: the Terms acceptance (a network or server problem kept it open) and the picture. Null when nothing is left. Names and address are never kept once saved, so a retry cannot overwrite later edits. */
export type Left = { termsOpen: boolean; pictureLeft: boolean }

export function nextPending(p: PendingSignup, left: Left): PendingSignup | null {
  if (!left.termsOpen && !left.pictureLeft) return null
  return { email: p.email, offerServices: p.offerServices, pictureUri: left.pictureLeft ? p.pictureUri : null, ...(left.termsOpen ? { termsAccepted: true } : {}) }
}

export const savePending = (p: PendingSignup) => SecureStore.setItemAsync(KEY, JSON.stringify(p))
export const clearPending = () => SecureStore.deleteItemAsync(KEY)

/** Stores what nextPending says is left, or clears the record. */
export const settle = (p: PendingSignup, left: Left) => {
  const n = nextPending(p, left)
  return n ? savePending(n) : clearPending()
}

export async function loadPending(): Promise<PendingSignup | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY)
    return raw ? (JSON.parse(raw) as PendingSignup) : null
  } catch {
    return null
  }
}
