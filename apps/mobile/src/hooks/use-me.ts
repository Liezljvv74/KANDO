import { useEffect, useSyncExternalStore } from 'react'

import type { Me } from '@kando/contract'

import { getMe } from '@/api/client'
import { notificationsApi } from '@/api/my-profile'
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
  if (started === generation && n === seq) set(m) // the newest request wins; an older, slower answer never overwrites it
  return m
}

export function clearMe() {
  generation++
  clearPending()
  set(null)
}

/** Marks every unseen notification seen (opening the setup page); a failure only leaves the dot a little longer. */
/** The notifications the customer has not seen yet. */
export const unseenOf = <T extends { seenAt: string | null }>(notifications: T[] | undefined) => (notifications ?? []).filter((n) => !n.seenAt)

export async function markNotificationsSeen() {
  const unseen = unseenOf(me?.notifications)
  if (!unseen.length) return
  await Promise.all(unseen.map((n) => notificationsApi.mark(n.id, { seen: true }))).catch(() => {})
  const now = new Date().toISOString()
  if (me) set({ ...me, notifications: me.notifications.map((n) => (unseen.some((u) => u.id === n.id) ? { ...n, seenAt: now } : n)) })
}

export async function dismissNotification(id: string) {
  await notificationsApi.mark(id, { dismissed: true })
  if (me) set({ ...me, notifications: me.notifications.map((n) => (n.id === id ? { ...n, dismissedAt: new Date().toISOString() } : n)) })
}

export function useMe() {
  const value = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => me,
  )
  useEffect(() => {
    if (!me) loadMe().catch(() => {})
  }, [])
  return value
}
