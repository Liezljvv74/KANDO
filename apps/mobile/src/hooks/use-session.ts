import { useEffect, useSyncExternalStore } from 'react'

import { File } from 'expo-file-system'

import * as auth from '@/api/auth'
import { ApiError, setOnUnauthorized, updateMe } from '@/api/client'
import { photosApi } from '@/api/my-profile'
import { clearMe as clearHeldMe, loadMe, setSignedInCheck } from '@/hooks/use-me'
import { getLang, setLang, type Lang } from '@/i18n'
import { flowCache } from '@/lib/flow-cache'
import { clearPending, loadPending, savePending, settle, type PendingSignup } from '@/lib/pending-signup'
import { registerForPush, unregisterPush } from '@/lib/push'

type User = auth.SessionUser
type State = { user: User | null; loading: boolean; offline: boolean }

let state: State = { user: null, loading: true, offline: false }
let started = false
let authBusy = false
/** True when the last load failed because the login server was busy (429/5xx), not because the phone is offline: the Retry screen says so. */
export const isAuthBusy = () => authBusy
const listeners = new Set<() => void>()

function set(next: State) {
  state = next
  listeners.forEach((l) => l())
}

/** Only a confirmed email counts as signed in; until then the auth screens stay. A session start registers for push (never awaited). */
function signedIn(user: User | null) {
  set({ user: user?.emailVerified ? user : null, loading: false, offline: false })
  if (state.user) {
    registerForPush()
    loadMe().catch(() => {}) // the tabs were mounted signed out, where `/me` is never asked
  }
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
    // A busy login server (429/5xx) is not a sign-out either: the cookie stays, the Retry screen shows. Only 401 clears it (client.ts).
    authBusy = e instanceof ApiError && (e.status === 429 || e.status >= 500)
    set({ user: null, loading: false, offline: authBusy || (e instanceof ApiError && e.status === 0) })
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
    // First, so a refused name below cannot lose it; a network blip here must not block the rest, so it is kept for the next launch.
    let termsOpen = false
    if (p.termsAccepted) await updateMe({ termsAccepted: true }).catch((e) => {
      // A refusal that will never pass (4xx other than busy or timeout) is dropped; only a network or server problem is retried.
      termsOpen = !(e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429)
    })
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
      await settle(p, { termsOpen, pictureDone: false })
    }
    if (p.pictureUri) {
      if (!new File(p.pictureUri).exists) return await settle(p, { termsOpen, pictureDone: true }) // the OS cleared its cache: nothing left to upload
      await photosApi.add({ uri: p.pictureUri, name: 'photo.jpg', type: 'image/jpeg' }, 'profile')
    }
    await settle(p, { termsOpen, pictureDone: true })
  } catch {
    // Kept for the next launch.
  }
}

/** How long the code screen waits for the sign-up data (names, picture, the provider draft) before it signs the person in anyway. */
export const SIGNUP_WAIT_MS = 8000

/**
 * A correct code finishes the sign-up and signs in; true when the person ticked "offer services".
 * The sign-up data is saved and `onOffering` (the provider setup: the draft profile) runs BEFORE the person counts as signed in: the root
 * layout switches to the tabs (Home) the moment they do, so a new provider stays on the code screen until the setup page can open.
 */
export async function verify(email: string, code: string, onOffering?: () => Promise<void>) {
  const user = await auth.verifyEmail(email, code)
  const pending = await pendingFor(user)
  const setup = (async () => {
    if (pending) await completeSignup(user)
    if (pending?.offerServices) await onOffering?.()
  })().catch(() => {
    // the code is used up: the person must still end up signed in (a kept record is finished at the next start)
  })
  // On a weak connection the picture upload or the draft can take very long: after SIGNUP_WAIT_MS the person is signed in
  // anyway and the rest finishes behind (or at the next start, from the kept record).
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([setup, new Promise((resolve) => (timer = setTimeout(resolve, SIGNUP_WAIT_MS)))])
  clearTimeout(timer)
  signedIn(user)
  if (!pending) updateMe({ language: getLang() }).catch(() => {}) // signing in with a still unconfirmed account: no form data
  return !!pending?.offerServices
}

/** The signed-out account's held data goes: /me and the Done flow's next-step data. */
const clearMe = () => (clearHeldMe(), flowCache.clear())

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
setSignedInCheck(() => !!state.user)

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
