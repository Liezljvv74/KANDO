import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { AppState } from 'react-native'

import { ApiError } from '@/api/client'

/** Runs `fn` on every focus and whenever the app returns to the front (e.g. from the browser). Old data stays while reloading; `fn` must be stable (module-level or useCallback). */
export function useLoad<T>(fn: () => Promise<T>) {
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
      return () => {
        sub.remove()
        cancel()
      }
    }, [load]),
  )
  const retry = () => {
    setState((s) => ({ ...s, error: null }))
    load()
  }
  return { ...state, retry }
}
