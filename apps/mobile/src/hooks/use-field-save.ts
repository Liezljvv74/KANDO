import { useEffect, useRef, useState } from 'react'

export type SaveStatus = 'saved' | 'saving' | 'error'

/**
 * The framework-free core: one field, one request at a time, quick changes coalesced into one request.
 * It only ever reports a status; the value stays with the caller and is never reset by a response or an error.
 */
export function createFieldSaver<V>(save: (value: V) => Promise<unknown>, delayMs: number, onStatus: (s: SaveStatus) => void) {
  let latest: V
  let dirty = false
  let inFlight = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const send = async (): Promise<void> => {
    if (inFlight || !dirty) return // a change made during a request is sent when it ends
    dirty = false
    inFlight = true
    try {
      await save(latest)
      inFlight = false
      if (dirty) return flush() // typed meanwhile: the status stays 'saving'
      onStatus('saved')
    } catch {
      inFlight = false
      onStatus('error') // the value stays; `retry` resends it (or a newer change does)
      if (dirty) flush()
    }
  }
  const flush = (): Promise<void> => {
    clearTimeout(timer)
    timer = undefined
    return send()
  }
  return {
    set(value: V) {
      latest = value
      dirty = true
      onStatus('saving')
      clearTimeout(timer)
      timer = setTimeout(flush, delayMs)
    },
    flush,
    retry() {
      dirty = true
      onStatus('saving')
      return flush()
    },
    /** Unmount: nothing typed is lost, but no timer outlives the screen. */
    dispose() {
      if (dirty) flush()
      clearTimeout(timer)
    },
  }
}

/** One instance per field: `setValue` on every keystroke, `flush` on blur. */
export function useFieldSave<V>(initial: V, save: (value: V) => Promise<unknown>, delayMs = 600) {
  const [value, setV] = useState(initial)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const saveRef = useRef(save)
  saveRef.current = save
  const saver = useRef<ReturnType<typeof createFieldSaver<V>>>(null)
  saver.current ??= createFieldSaver<V>((v) => saveRef.current(v), delayMs, setStatus)
  useEffect(() => () => saver.current?.dispose(), [])
  return {
    value,
    setValue: (v: V) => {
      setV(v)
      saver.current!.set(v)
    },
    status,
    retry: () => void saver.current!.retry(),
    flush: () => void saver.current!.flush(),
  }
}
