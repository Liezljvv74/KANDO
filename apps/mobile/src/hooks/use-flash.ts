import { useEffect, useRef, useState } from 'react'

/** A switch that turns itself off after `ms`; `hide` turns it off at once. */
export function createFlash(onChange: (on: boolean) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const hide = () => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
    onChange(false)
  }
  return {
    show() {
      clearTimeout(timer)
      onChange(true)
      timer = setTimeout(hide, ms)
    },
    hide,
    dispose: () => clearTimeout(timer),
  }
}

/** `[on, show, hide]`: for a short "Saved" message that clears itself (and when the user edits again). */
export function useFlash(ms = 3000) {
  const [on, setOn] = useState(false)
  const flash = useRef<ReturnType<typeof createFlash>>(null)
  flash.current ??= createFlash(setOn, ms)
  useEffect(() => () => flash.current?.dispose(), [])
  return [on, flash.current.show, flash.current.hide] as const
}
