import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { AppState } from 'react-native'

import { ApiError } from '@/api/client'

/**
 * Runs `fn` on every focus and whenever the app returns to the front (e.g. from the browser). Old data stays while reloading; `fn` must be stable (module-level or useCallback).
 * `pollMs`: also again at that interval while the screen is focused and the app is in front (a message or a payment that arrives while the page is open shows without leaving it).
 */
export function useLoad<T>(fn: () => Promise<T>, opts: { pollMs?: number } = {}) {
  const [state, setState] = useState<{ done: boolean; data: T | undefined; error: string | null }>({ done: false, data: undefined, error: null })
  const load = useCallback(() => {
    let live = true
    fn()
      .then((data) => live && setState({ done: true, data, error: null }))
      .catch((e) => live && setState((s) => ({ ...s, error: e instanceof ApiError ? e.code : 'network' })))
    return () => {
      live = false
    }
  }, [fn])
  useFocusEffect(
    useCallback(() => {
      let cancel = load()
      // Changes made outside the app (a staff approval, the admin panel) show as soon as the user comes back.
      const sub = AppState.addEventListener('change', (s) => {
        if (s !== 'active') return
        cancel()
        cancel = load()
      })
      const timer = opts.pollMs
        ? setInterval(() => {
            if (AppState.currentState !== 'active') return
            cancel()
            cancel = load()
          }, opts.pollMs)
        : undefined
      return () => {
        sub.remove()
        if (timer) clearInterval(timer)
        cancel()
      }
    }, [load, opts.pollMs]),
  )
  const retry = () => {
    setState((s) => ({ ...s, error: null }))
    load()
  }
  /** Replaces part of the held data with a save's answer, without a reload. */
  const update = useCallback((f: (data: T) => T) => setState((s) => (s.data === undefined ? s : { ...s, data: f(s.data) })), [])
  return { ...state, retry, update }
}
