import { useEffect, useRef, useState } from 'react'

/** A switch that turns itself off after `ms`; `hide` turns it off at once. */
export function createFlash(onChange: (on: boolean) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const hide = () => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
    onChange(false)
  }
  return {
    show() {
      if (disposed) return
      clearTimeout(timer)
      onChange(true)
      timer = setTimeout(hide, ms)
    },
    hide,
    dispose() {
      disposed = true
      clearTimeout(timer)
    },
  }
}

/** `[on, show, hide]`: for a short "Saved" message that clears itself (and when the user edits again). */
export function useFlash(ms = 3000) {
  const [on, setOn] = useState(false)
  const flash = useRef<ReturnType<typeof createFlash>>(null)
  const get = () => (flash.current ??= createFlash(setOn, ms))
  // Cleanup drops the flash, so a remount (Fast Refresh) starts a live one instead of a disposed one.
  useEffect(
    () => () => {
      flash.current?.dispose()
      flash.current = null
    },
    [],
  )
  return [on, () => get().show(), () => get().hide()] as const
}
