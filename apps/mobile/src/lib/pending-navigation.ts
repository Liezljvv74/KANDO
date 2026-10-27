import { useSyncExternalStore } from 'react'

import { showProfileTab } from '@/lib/profile-tab'

export type PendingNavigation = { path: '/my-profile'; welcome?: boolean }

/** Where to go once the tabs layout shows the target tab (navigating to a hidden tab falls back to Home). */
let pending: PendingNavigation | null = null
const listeners = new Set<() => void>()
const set = (next: PendingNavigation | null) => {
  pending = next
  listeners.forEach((l) => l())
}

export const setPending = (p: PendingNavigation) => set(p)
export const clearPending = () => set(null)
export function consumePending() {
  const p = pending
  if (p) set(null)
  return p
}
export const readyToNavigate = (p: PendingNavigation | null, me: { isProvider: boolean } | null) => !!p && showProfileTab(me)
export const urlOf = (p: PendingNavigation) => (p.welcome ? `${p.path}?welcome=1` : p.path) as '/my-profile'

export const usePending = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => pending,
  )
