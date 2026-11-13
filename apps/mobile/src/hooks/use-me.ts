import { useEffect, useSyncExternalStore } from 'react'

import type { Me, Notification } from '@kando/contract'

import { getMe, setOnTermsRequired } from '@/api/client'
import { notificationsApi } from '@/api/my-profile'
import { noteMe } from '@/lib/payments-off'
import { clearPending } from '@/lib/pending-navigation'

/** The one place `GET /me` is loaded: the home nudge, the account tab and the setup page all read this copy. */
let me: Me | null = null
const listeners = new Set<() => void>()
const set = (next: Me | null) => {
  me = next
  listeners.forEach((l) => l())
}

let generation = 0
let seq = 0
export const currentMe = () => me
/** Changes at every sign-out: a long task snapshots it to know the account is gone. */
export const signOutGeneration = () => generation

/** Fetches `/me` and replaces the shared copy, unless the user signed out meanwhile (the next account must not get this one's data). */
export async function loadMe() {
  const started = generation
  const n = ++seq
  const m = await getMe()
  noteMe(m)
  if (started === generation && n === seq) set(m) // the newest request wins; an older, slower answer never overwrites it
  return m
}

/** The person chose "I do not agree" and went to the account page (to delete the account): the pop-up stays away until a write is refused again or the app restarts. */
let aside = false
export const setAside = (v: boolean) => {
  aside = v
  listeners.forEach((l) => l())
}

// A write answered 428 terms-required: the shared copy is reloaded, its termsRequired shows the accept pop-up (again, if it was set aside).
setOnTermsRequired(() => {
  setAside(false)
  loadMe().catch(() => {})
})

export function clearMe() {
  generation++
  aside = false
  firstLoad = null // a load still on its way belongs to the old account: the next ensureMe starts a fresh one
  clearPending()
  set(null)
}

/** The notifications the customer has not seen yet. */
export const unseenOf = <T extends { seenAt: string | null }>(notifications: T[] | undefined) => (notifications ?? []).filter((n) => !n.seenAt)

/** Marks the unseen notifications that pass `only` (all by default) seen. Only the ones the server saved turn seen here; a failed one keeps its number until the next try. */
export async function markNotificationsSeen(only: (n: Notification) => boolean = () => true) {
  const unseen = unseenOf(me?.notifications).filter(only)
  if (!unseen.length) return
  const results = await Promise.allSettled(unseen.map((n) => notificationsApi.mark(n.id, { seen: true })))
  const saved = unseen.filter((_, i) => results[i]!.status === 'fulfilled')
  const now = new Date().toISOString()
  if (me && saved.length) set({ ...me, notifications: me.notifications.map((n) => (saved.some((u) => u.id === n.id) ? { ...n, seenAt: now } : n)) })
}

let firstLoad: Promise<Me> | null = null
/** Loads `/me` unless it is held or already on its way: any number of screens mounting together make one request. */
/** Set by the session: signed out there is no `/me` to ask (it would answer 401 on every screen a visitor opens). */
let signedInNow: () => boolean = () => true
export const setSignedInCheck = (fn: () => boolean) => void (signedInNow = fn)

export function ensureMe() {
  if (me) return Promise.resolve(me)
  if (!signedInNow()) return Promise.reject(new Error('signed out'))
  if (firstLoad) return firstLoad
  const p: Promise<Me> = loadMe().finally(() => {
    if (firstLoad === p) firstLoad = null // a sign-out may have started a newer one meanwhile
  })
  return (firstLoad = p)
}

/** A save answered with the provider's profile: its fresh quote steps replace the held ones without a request. */
export function noteQuoteSteps(steps: Me['quoteSteps']) {
  if (me && steps) set({ ...me, quoteSteps: steps })
}

export function useMe() {
  const value = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => me,
  )
  useEffect(() => {
    ensureMe().catch(() => {})
  }, [])
  return value
}

/** What a provider still needs before quoting, read from the shared `/me` (the job page, the quote gate and My business): undefined until `/me` arrives, or from an older server. */
export function useQuoteSteps() {
  return { steps: useMe()?.quoteSteps, reload: loadMe }
}

/** true while the accept pop-up must cover the app: the Terms changed since the person accepted and they have not set it aside. */
export function useTermsPopup() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => me?.termsRequired === true && !aside,
  )
}
