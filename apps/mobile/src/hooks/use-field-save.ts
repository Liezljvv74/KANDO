import { useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { sendNow } from '@/lib/pending-runner'
import { putEntry, removeKey, usePendingEntry, type SaveKind } from '@/lib/pending-saves'

export type SaveStatus = 'saved' | 'saving' | 'error'

/** The value is kept in the pending-saves store from the moment it is set; the registered sender for `kind` does the API call. */
export type FieldQueue<V> = { key: string; kind: SaveKind; accountId: string; route: string; field: string; serviceRef?: string; toBody: (v: V) => object | null }

/**
 * The framework-free core: one field, one request at a time, quick changes coalesced into one request.
 * It only ever reports a status; the value stays with the caller and is never reset by a response or an error.
 */
export function createFieldSaver<V>(save: (value: V) => Promise<unknown>, delayMs: number, onStatus: (s: SaveStatus) => void, queue?: () => FieldQueue<V>) {
  let latest: V
  let dirty = false
  let running: Promise<void> | null = null // the loop below: one request at a time, until nothing is dirty
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastOk = true // did the most recent save work (true when nothing was ever sent)
  let queueKey: string | undefined // the key the newest value was put under (it can change when a service gets its real id)

  const run = async (): Promise<void> => {
    while (dirty) {
      dirty = false // a change made during a request is sent when it ends; the status stays 'saving' until then
      try {
        if (queue) {
          if ((await sendNow(queueKey ?? queue().key)) !== 'ok') throw new Error('not saved')
        } else await save(latest)
        lastOk = true
        if (!dirty) onStatus('saved')
      } catch {
        lastOk = false
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
      if (queue) {
        const q = queue()
        queueKey = q.key
        const body = q.toBody(value)
        if (!body) {
          removeKey(q.key)
          dirty = false
          clearTimeout(timer)
          timer = undefined
          onStatus('saved')
          return
        }
        putEntry({ key: q.key, kind: q.kind, accountId: q.accountId, body, serviceRef: q.serviceRef, route: q.route, field: q.field })
      }
      dirty = true
      onStatus('saving')
      clearTimeout(timer)
      timer = setTimeout(flush, delayMs)
    },
    flush,
    /** The app is leaving the front: same as flush, named for its caller. */
    flushNow: flush,
    /** Like flush, but resends a value whose last save failed, and says whether the last save worked. */
    async commit(): Promise<boolean> {
      if (!lastOk) dirty = true
      await flush()
      return lastOk
    },
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
export function useFieldSave<V>(initial: V, save: (value: V) => Promise<unknown>, delayMs = 600, queue?: FieldQueue<V>) {
  const [value, setV] = useState(initial)
  const pending = usePendingEntry(queue?.key ?? '')
  const [status, setStatus] = useState<SaveStatus>(pending?.state === 'refused' ? 'error' : 'saved')
  const saveRef = useRef(save)
  saveRef.current = save
  const queueRef = useRef(queue)
  queueRef.current = queue
  const saver = useRef<ReturnType<typeof createFieldSaver<V>>>(null)
  saver.current ??= createFieldSaver<V>((v) => saveRef.current(v), delayMs, setStatus, queue && (() => queueRef.current!))
  useEffect(() => {
    // Nothing typed waits for the 600 ms timer when the app goes to the background.
    const sub = AppState.addEventListener('change', (s) => s !== 'active' && void saver.current?.flushNow())
    return () => {
      sub.remove()
      saver.current?.dispose()
    }
  }, [])
  return {
    value,
    setValue: (v: V) => {
      setV(v)
      saver.current!.set(v)
    },
    status,
    /** The error text key of the stored entry (the server's error code for a refused one, else 'network'), null when nothing is stored. */
    errorCode: pending ? (pending.state === 'refused' ? (pending.reason ?? 'network') : 'network') : null,
    retry: () => void saver.current!.retry(),
    /** Resolves when nothing is dirty and nothing is in flight. */
    flush: () => saver.current!.flush(),
    /** Resolves true only when the last save worked (a failed value is resent first). */
    commit: () => saver.current!.commit(),
  }
}
