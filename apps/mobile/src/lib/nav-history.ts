import { useSyncExternalStore } from 'react'

/**
 * The Forward arrow. The router only remembers where you came from, so Forward works like a browser's: pressing Back remembers the
 * page it left, Forward goes back to it. Any other navigation (a tab, a button, a link) clears it.
 */
let forward: string[] = []
let ours = 0 // when Back or Forward last moved: the route change that follows is theirs, not a new navigation
const OURS_MS = 1500
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())

/** A route as one string: the path plus the query values that are not already a path segment (a dynamic segment such as the provider's slug). */
export function hrefOf(pathname: string, params: Record<string, string | string[] | undefined>): string {
  const q = Object.entries(params)
    .filter((e): e is [string, string] => typeof e[1] === 'string' && !pathname.split('/').includes(e[1]))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  return q ? `${pathname}?${q}` : pathname
}

/** The Back arrow is about to go back from `current`: remember it for Forward. */
export function backFrom(current: string) {
  forward.push(current)
  ours = Date.now()
  changed()
}

/** The page Back came from (most recent first), or null. The caller opens it. */
export function forwardTo(): string | null {
  const next = forward.pop() ?? null
  if (next) ours = Date.now()
  changed()
  return next
}

/** Called on every route change: one made by Back or Forward keeps the list, any other clears it. */
export function noteRoute(_path: string) {
  if (Date.now() - ours < OURS_MS) ours = 0
  else if (forward.length) {
    forward = []
    changed()
  }
}

export const canGoForward = () => forward.length > 0
export const resetNavHistory = () => {
  forward = []
  ours = 0
}

export const useCanGoForward = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    canGoForward,
  )
