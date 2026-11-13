import { useSyncExternalStore } from 'react'

/**
 * The Forward arrow. The router only remembers where you came from, so Forward works like a browser's: pressing Back remembers the
 * page it left, Forward goes back to it. Any other navigation (a tab, a button, a link) clears it.
 *
 * An arrow says so itself (`moving`) before it navigates, so the route change that follows is known to be its own. No clock.
 */
let forward: string[] = []
let current = '' // where the app is now, as the root layout last reported it
let moving = false // an arrow was pressed and its route change has not arrived yet
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

/**
 * The Back arrow was pressed: remembers the current page for Forward. False while an earlier arrow press is still on its way (a
 * double tap); the caller then does nothing.
 * ponytail: an arrow move that lands on the very same route (the same page opened twice in a row) reports no change, so the arrows
 * ignore presses until the next navigation; listen to the navigation state itself if that ever shows.
 */
export function backFrom(): boolean {
  if (moving) return false
  forward.push(current)
  moving = true
  changed()
  return true
}

/** The Forward arrow was pressed: the page Back came from (most recent first) for the caller to open, or null. */
export function forwardTo(): string | null {
  if (moving) return null
  const next = forward.pop() ?? null
  if (next) {
    moving = true
    changed()
  }
  return next
}

/** Called by the root layout on every route change: one made by an arrow keeps the list, any other clears it. */
export function noteRoute(href: string) {
  const byArrow = moving
  moving = false
  current = href
  if (!byArrow && forward.length) {
    forward = []
    changed()
  }
}

export const canGoForward = () => forward.length > 0
export const resetNavHistory = () => {
  forward = []
  current = ''
  moving = false
}

export const useCanGoForward = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    canGoForward,
  )
