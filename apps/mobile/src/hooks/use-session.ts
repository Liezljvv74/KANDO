import { useEffect, useSyncExternalStore } from 'react'

import { File } from 'expo-file-system'

import * as auth from '@/api/auth'
import { ApiError, setOnUnauthorized, updateMe } from '@/api/client'
import { photosApi } from '@/api/my-profile'
import { getLang, setLang, type Lang } from '@/i18n'
import { clearPending, loadPending, savePending, type PendingSignup } from '@/lib/pending-signup'

type User = auth.SessionUser
type State = { user: User | null; loading: boolean; offline: boolean }

let state: State = { user: null, loading: true, offline: false }
let started = false
const listeners = new Set<() => void>()

function set(next: State) {
  state = next
  listeners.forEach((l) => l())
}

/** Only a confirmed email counts as signed in; until then the auth screens stay. */
const signedIn = (user: User | null) => set({ user: user?.emailVerified ? user : null, loading: false, offline: false })

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
  try {
    if (p.firstName && p.lastName) {
      await updateMe({ firstName: p.firstName, lastName: p.lastName, language: getLang(), ...(p.address && { address: p.address }) })
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
  else updateMe({ name: user.name, language: getLang() }).catch(() => {}) // signing in with a still unconfirmed account: no form data
  return !!pending?.offerServices
}

export async function signOut() {
  set({ user: null, loading: false, offline: false })
  await auth.signOut()
}

/** Saves the account name; the session user follows. Errors (e.g. 400 'Invalid input' naming the field) are thrown to the form. */
export async function updateName(name: string) {
  await updateMe({ name })
  try {
    await auth.updateUserName(name)
  } catch {
    // The auth account's copy is what the next app start shows; a failure only shows the old name there until the next save.
  }
  if (state.user) set({ ...state, user: { ...state.user, name } })
}

/** Switches the app language; signed in, the account follows so emails come in the same language. */
export function chooseLanguage(lang: Lang) {
  setLang(lang)
  if (state.user) updateMe({ language: lang }).catch(() => {})
}

export const getSession = () => state

// The server no longer accepts the session: back to the login (Stack.Protected follows `user`).
setOnUnauthorized(() => set({ user: null, loading: false, offline: false }))

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
  return { ...s, signIn, signUp, verify, signOut, updateName, retry: loadSession }
}
