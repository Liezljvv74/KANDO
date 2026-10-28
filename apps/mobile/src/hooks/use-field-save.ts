import { useEffect, useRef, useState } from 'react'

export type SaveStatus = 'saved' | 'saving' | 'error'

/**
 * The framework-free core: one field, one request at a time, quick changes coalesced into one request.
 * It only ever reports a status; the value stays with the caller and is never reset by a response or an error.
 */
export function createFieldSaver<V>(save: (value: V) => Promise<unknown>, delayMs: number, onStatus: (s: SaveStatus) => void) {
  let latest: V
  let dirty = false
  let running: Promise<void> | null = null // the loop below: one request at a time, until nothing is dirty
  let timer: ReturnType<typeof setTimeout> | undefined

  const run = async (): Promise<void> => {
    while (dirty) {
      dirty = false // a change made during a request is sent when it ends; the status stays 'saving' until then
      try {
        await save(latest)
        if (!dirty) onStatus('saved')
      } catch {
        onStatus('error') // the value stays; `retry` resends it (or a newer change does)
      }
    }
    running = null
  }
  /** Resolves when nothing is dirty and nothing is in flight (also the follow-up save for the newest value). */
  const flush = (): Promise<void> => {
    clearTimeout(timer)
    timer = undefined
    if (!running && dirty) running = run()
    return running ?? Promise.resolve()
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
    /** Resolves when nothing is dirty and nothing is in flight. */
    flush: () => saver.current!.flush(),
  }
}
