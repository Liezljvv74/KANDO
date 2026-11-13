import { useSyncExternalStore } from 'react'

/**
 * The Forward arrow. The router only remembers where you came from, so Forward works like a browser's: going back (the Back arrow,
 * the Android back button or the iPhone swipe alike) remembers the page that was left, Forward opens it again. Any other navigation
 * (a tab, a button, a link) clears it.
 *
 * Everything is worked out from the route changes the root layout reports (`noteRoute`): a route that is already on the trail is a
 * step back, the route Forward just asked for is a step forward, anything else is a new page. No flag set by a button, no clock.
 */
const MAX_TRAIL = 50
let trail: string[] = [] // the pages opened, oldest first; the last one is where the app is now
let forward: string[] = [] // the pages gone back from, the most recent last
let asked: string | null = null // the page the Forward arrow asked for, until its route change arrives
const listeners = new Set<() => void>()

/**
 * A route as one string: the path plus its query values. `segments` is the route's file path (`['bookings', '[id]']`): a value that
 * fills a dynamic segment is already part of the path and is left out, by its name.
 */
export function hrefOf(pathname: string, params: Record<string, string | string[] | undefined>, segments: string[] = []): string {
  const inPath = new Set(segments.map((s) => /^\[(?:\.\.\.)?(.+)\]$/.exec(s)?.[1]))
  const q = Object.entries(params)
    .filter((e): e is [string, string] => typeof e[1] === 'string' && !inPath.has(e[0]))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  return q ? `${pathname}?${q}` : pathname
}

/** Called on every route change. The same address again (a page opened on top of itself, or closed again) changes nothing. */
export function noteRoute(href: string) {
  const current = trail[trail.length - 1]
  if (href === current) return
  const had = forward.length > 0
  const back = trail.lastIndexOf(href)
  if (href === asked) trail.push(href)
  else if (back >= 0) {
    trail.length = back + 1
    forward.push(current!) // only the page that was left: Forward returns to it
  } else {
    trail.push(href)
    forward = []
  }
  asked = null
  if (trail.length > MAX_TRAIL) trail.shift()
  if (had !== forward.length > 0) listeners.forEach((l) => l())
}

/** The Forward arrow was pressed: the page to open (the one most recently gone back from), or null. A second press before the first has arrived does nothing. */
export function forwardTo(): string | null {
  if (asked) return null
  asked = forward.pop() ?? null
  if (asked && !forward.length) listeners.forEach((l) => l())
  return asked
}

export const canGoForward = () => forward.length > 0
export const resetNavHistory = () => {
  trail = []
  forward = []
  asked = null
}

export const useCanGoForward = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    canGoForward,
  )
