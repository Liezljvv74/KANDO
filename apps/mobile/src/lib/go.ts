import { router, type Href } from 'expo-router'

/** Opens a route with query params; a plain string keeps new routes working before the typed-routes file is regenerated. */
const href = (path: string, params?: Record<string, string>) => (params ? `${path}?${new URLSearchParams(params)}` : path) as Href
/** False for the same route again within the window: a double tap (or a slow screen) opens one screen, not two. */
export const navGuard = (windowMs = 1000) => {
  let last = ''
  let at = -Infinity
  return (h: string, now = Date.now()) => {
    if (h === last && now - at < windowMs) return false
    last = h
    at = now
    return true
  }
}
const allow = navGuard()
export const go = (path: string, params?: Record<string, string>) => {
  const h = href(path, params)
  if (allow(String(h))) router.push(h)
}
/** Back, or home when there is nothing to go back to (a screen opened from a notice link). */
export const goBack = () => (router.canGoBack() ? router.back() : router.replace('/' as Href))
export const goReplace = (path: string, params?: Record<string, string>) => {
  const h = href(path, params)
  if (allow(String(h))) router.replace(h)
}
