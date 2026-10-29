import { router, type Href } from 'expo-router'

/** Opens a route with query params; a plain string keeps new routes working before the typed-routes file is regenerated. */
const href = (path: string, params?: Record<string, string>) => (params ? `${path}?${new URLSearchParams(params)}` : path) as Href
export const go = (path: string, params?: Record<string, string>) => router.push(href(path, params))
export const goReplace = (path: string, params?: Record<string, string>) => router.replace(href(path, params))
