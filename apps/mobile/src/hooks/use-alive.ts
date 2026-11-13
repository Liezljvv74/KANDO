import { useEffect, useRef } from 'react'

/** `.current` is true while the component is mounted: an answer that arrives after the screen was left must not navigate. */
export function useAlive() {
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => void (alive.current = false)
  }, [])
  return alive
}
