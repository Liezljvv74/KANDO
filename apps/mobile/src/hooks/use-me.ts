import { useEffect, useSyncExternalStore } from 'react'

import type { Me, Notification } from '@kando/contract'

import { getMe } from '@/api/client'
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

export function clearMe() {
  generation++
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
