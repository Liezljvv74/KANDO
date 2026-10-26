import { useEffect, useSyncExternalStore } from 'react'

import * as auth from '@/api/auth'
import { ApiError, setOnUnauthorized, updateMe } from '@/api/client'
import { getLang } from '@/i18n'

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
    signedIn(await auth.session())
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

/** Creates the account and emails the confirmation code (the server does not send one on sign-up). */
export async function signUp(name: string, email: string, password: string) {
  await auth.signUp(email, password, name)
  await auth.sendVerificationCode(email)
}

/** A correct code signs in; the account name and app language go to the app's own record (public name, email language). */
export async function verify(email: string, code: string) {
  const user = await auth.verifyEmail(email, code)
  signedIn(user)
  updateMe({ name: user.name, language: getLang() }).catch(() => {})
}

export async function signOut() {
  set({ user: null, loading: false, offline: false })
  await auth.signOut()
}

/** Saves the account name; the session user follows. Errors (e.g. 400 'Invalid name') are thrown to the form. */
export async function updateName(name: string) {
  await updateMe({ name })
  try {
    await auth.updateUserName(name)
  } catch {
    // The auth account's copy is what the next app start shows; a failure only shows the old name there until the next save.
  }
  if (state.user) set({ ...state, user: { ...state.user, name } })
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
