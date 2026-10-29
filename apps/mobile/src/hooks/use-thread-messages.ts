import { useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'

import { MESSAGES_PAGE, type Message } from '@kando/contract'

import { listMessages, sendMessage, sendPhoto as sendPhotoApi } from '@/api/chat'
import { ApiError, type PickedFile } from '@/api/client'
import { errorText } from '@/i18n'

/** Live delivery is polling (decided for this release); a push channel would replace only the timer in `createMessageFeed`. */
export const POLL_SECONDS = 4
const MAX_BACKOFF_MS = 60_000

const byTime = (a: Message, b: Message) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1)

/** Adds the messages not known yet (by id); with `replace` a known message is swapped for the incoming one (its photo link is fresh again). */
export function mergeMessages(existing: Message[], incoming: Message[], replace = false): Message[] | null {
  const byId = new Map(existing.map((m) => [m.id, m]))
  let changed = false
  for (const m of incoming) {
    if (!byId.has(m.id) || replace) {
      byId.set(m.id, m)
      changed = true
    }
  }
  return changed ? [...byId.values()].sort(byTime) : null
}

/**
 * The messages of one thread, and the poll that keeps them current: `start` loads at once and then every POLL_SECONDS
 * with the cursor of the last polled message; `stop` ends it (an answer still on its way is dropped). A failed poll waits twice
 * as long as the one before, up to a minute; a 404 (no such thread) ends it. The server answers the OLDEST page first, so a full page is followed
 * by the next request at once; `onCaughtUp` fires once, when the first partial page has arrived (the screen scrolls down then). `add` shows a message the person just sent, without moving the cursor
 * (a message of the other side that is older than mine must still come in).
 */
export function createMessageFeed(list: (after?: string) => Promise<Message[]>, onMessages: (m: Message[]) => void, onError: (code: string | null) => void, onCaughtUp: () => void = () => {}) {
  let messages: Message[] = []
  let cursor: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  let caughtUp = false
  let epoch = 0 // changes on stop/start: an answer from an older run is ignored
  let reloading = false // the run from the start after `reload`: known messages are replaced (fresh photo links)

  const merge = (incoming: Message[], replace = false) => {
    const next = mergeMessages(messages, incoming, replace)
    if (!next) return false
    messages = next
    onMessages(messages)
    return true
  }

  async function tick() {
    const run = epoch
    try {
      const docs = await list(cursor)
      if (run !== epoch) return
      failures = 0
      onError(null)
      const last = docs.at(-1)
      if (last) cursor = `${last.createdAt}|${last.id}`
      merge(docs, reloading)
      if (docs.length >= MESSAGES_PAGE) return tick() // more waiting: no pause
      reloading = false
      if (!caughtUp) {
        caughtUp = true
        onCaughtUp()
      }
    } catch (e) {
      if (run !== epoch) return
      if (e instanceof ApiError && e.status === 404) return onError('Not found') // nothing to retry
      failures++
      onError(e instanceof ApiError ? e.code : 'network')
    }
    timer = setTimeout(tick, Math.min(MAX_BACKOFF_MS, POLL_SECONDS * 1000 * 2 ** failures))
  }

  const stop = () => {
    epoch++
    clearTimeout(timer)
    timer = undefined
  }
  return {
    start() {
      stop()
      failures = 0
      void tick()
    },
    stop,
    /** Load the whole thread again from the start (photo links expire after ten minutes) and replace what is shown by id. */
    reload() {
      cursor = undefined
      reloading = true
      this.start()
    },
    add: (m: Message) => void merge([m]),
  }
}

/** The thread's messages, polled while the screen is focused and the app is in front. `send`/`sendPhoto` throw when the server refuses (`error` then holds the text for under the input). */
export function useThreadMessages(threadId: string) {
  const [messages, setMessages] = useState<Message[]>([])
  const [pollError, setPollError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const feed = useMemo(() => createMessageFeed((after) => listMessages(threadId, after), setMessages, setPollError, () => setLoaded(true)), [threadId])

  useFocusEffect(
    useCallback(() => {
      if (AppState.currentState === 'active') feed.start()
      const sub = AppState.addEventListener('change', (s) => (s === 'active' ? feed.reload() : feed.stop()))
      return () => {
        sub.remove()
        feed.stop()
      }
    }, [feed]),
  )

  async function deliver(post: () => Promise<Message>) {
    setSendError(null)
    try {
      feed.add(await post())
    } catch (e) {
      setSendError(errorText(e instanceof ApiError ? e.code : 'network'))
      throw e
    }
  }

  const lastRefresh = useRef(0)
  /** An image failed to load (its link expired): fetch fresh links, at most once every 30 seconds. */
  const refreshLinks = useCallback(() => {
    if (Date.now() - lastRefresh.current < 30_000) return
    lastRefresh.current = Date.now()
    feed.reload()
  }, [feed])

  return {
    messages,
    loaded,
    refreshLinks,
    send: (body: string) => deliver(() => sendMessage(threadId, body)),
    sendPhoto: (file: PickedFile) => deliver(() => sendPhotoApi(threadId, file)),
    error: sendError ?? (pollError ? errorText(pollError) : null),
  }
}
