import { useEffect, useSyncExternalStore } from 'react'

import { File } from 'expo-file-system'

import * as auth from '@/api/auth'
import { ApiError, setOnUnauthorized, updateMe } from '@/api/client'
import { photosApi } from '@/api/my-profile'
import { clearMe, loadMe } from '@/hooks/use-me'
import { getLang, setLang, type Lang } from '@/i18n'
import { clearPending, loadPending, savePending, type PendingSignup } from '@/lib/pending-signup'
import { registerForPush, unregisterPush } from '@/lib/push'

type User = auth.SessionUser
type State = { user: User | null; loading: boolean; offline: boolean }

let state: State = { user: null, loading: true, offline: false }
let started = false
const listeners = new Set<() => void>()

function set(next: State) {
  state = next
  listeners.forEach((l) => l())
}

/** Only a confirmed email counts as signed in; until then the auth screens stay. A session start registers for push (never awaited). */
function signedIn(user: User | null) {
  set({ user: user?.emailVerified ? user : null, loading: false, offline: false })
  if (state.user) registerForPush()
}

/** Loads the signed-in user. A lost connection sets `offline` (cookie kept) so the app can offer a retry instead of the login form. */
export async function loadSession() {
  started = true
  set({ user: null, loading: true, offline: false })
  try {
    const user = await auth.session()
    signedIn(user)
    if (user?.emailVerified) completeSignup(user).catch(() => {}) // a sign-up the last launch could not finish
  } catch (e) {
    set({ user: null, loading: false, offline: e instanceof ApiError && e.status === 0 })
  }
}

/** 'verify' when the email is not confirmed yet: a code has been sent and the code screen comes next. */
export async function signIn(email: string, password: string): Promise<'signed-in' | 'verify'> {
  let user: User
  try {
    user = await auth.signIn(email, password)
  } catch (e) {
    // Only when the server requires confirmed emails before sign-in.
    if (!(e instanceof ApiError && e.code === 'EMAIL_NOT_VERIFIED')) throw e
    await auth.sendVerificationCode(email)
    return 'verify'
  }
  if (!user.emailVerified) {
    await auth.sendVerificationCode(email)
    return 'verify'
  }
  signedIn(user)
  return 'signed-in'
}

/** Creates the account and emails the confirmation code (the server does not send one on sign-up). `pending` is kept for the code step; a failed sign-up leaves none. */
export async function signUp(name: string, email: string, password: string, pending?: PendingSignup) {
  if (pending) await savePending(pending)
  try {
    await auth.signUp(email, password, name)
    await auth.sendVerificationCode(email)
  } catch (e) {
    await clearPending()
    throw e
  }
}

/** The pending record for this user, or null; a record made for another email is dropped. */
async function pendingFor(user: User) {
  const p = await loadPending()
  if (p && p.email !== user.email.trim().toLowerCase()) {
    await clearPending()
    return null
  }
  return p
}

/** Saves what the sign-up form collected: names and address, then the picture. A failed step keeps the record; loadSession retries it. */
export async function completeSignup(user: User) {
  const p = await pendingFor(user)
  if (!p) return
  await finish(p)
  await loadMe().catch(() => {}) // the home picture nudge must not show for a picture just saved
}

async function finish(p: PendingSignup) {
  try {
    if (p.firstName && p.lastName) {
      const names = { firstName: p.firstName, lastName: p.lastName, language: getLang() }
      // A postcode the server refuses must not block the names for good (the form cannot show it any more): saved without the address.
      try {
        await updateMe({ ...names, ...(p.address && { address: p.address }) }).catch((e) => {
          if (e instanceof ApiError && e.code === 'Invalid postcode') return updateMe(names)
          throw e
        })
      } catch (e) {
        // A name the server refuses as contact details never passes: dropped, not retried; the account screen shows the refusal later.
        if (!(e instanceof ApiError && e.code === 'CONTACT_DETAILS')) throw e
      }
      // Saved: a retry only repeats the picture, so later edits are never overwritten.
      await savePending({ email: p.email, offerServices: p.offerServices, pictureUri: p.pictureUri })
    }
    if (p.pictureUri) {
      if (!new File(p.pictureUri).exists) return await clearPending() // the OS cleared its cache: nothing left to upload
      await photosApi.add({ uri: p.pictureUri, name: 'photo.jpg', type: 'image/jpeg' }, 'profile')
    }
    await clearPending()
  } catch {
    // Kept for the next launch.
  }
}

/** A correct code signs in and finishes the sign-up; true when the person ticked "offer services" (the screen then opens the provider page). */
export async function verify(email: string, code: string) {
  const user = await auth.verifyEmail(email, code)
  const pending = await pendingFor(user)
  signedIn(user)
  if (pending) await completeSignup(user)
  else updateMe({ language: getLang() }).catch(() => {}) // signing in with a still unconfirmed account: no form data
  return !!pending?.offerServices
}

export async function signOut() {
  clearMe()
  set({ user: null, loading: false, offline: false })
  await unregisterPush() // while the session still exists
  await auth.signOut()
}

/** Switches the app language; signed in, the account follows so emails come in the same language. */
export function chooseLanguage(lang: Lang) {
  setLang(lang)
  if (state.user) updateMe({ language: lang }).catch(() => {})
}

export const getSession = () => state

// The server no longer accepts the session: back to the login (Stack.Protected follows `user`).
// The push token is forgotten too, so the next sign-in registers it again.
setOnUnauthorized(() => (clearMe(), unregisterPush(), set({ user: null, loading: false, offline: false })))

/** Test helper. */
export const resetSession = () => {
  started = false
  state = { user: null, loading: true, offline: false }
}

export function useSession() {
  const s = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  )
  useEffect(() => {
    if (!started) loadSession()
  }, [])
  return { ...s, signIn, signUp, verify, signOut, retry: loadSession }
}
