import { AppState } from 'react-native'
import { ApiError } from '@/api/client'
import { clearIfVersion, dropService, listEntries, loadStore, markFailed, type PendingEntry, type SaveKind } from '@/lib/pending-saves'

const RETRY_SECONDS = [2, 5, 15, 45, 60]
const SEND_LIMIT_MS = 30_000

type Sender = (e: PendingEntry) => Promise<void>
type FieldFor = (err: unknown) => string | undefined

const senders = new Map<SaveKind, Sender>()
const fieldFors = new Map<SaveKind, FieldFor>()
const locks = new Map<string, Promise<unknown>>()
const running = new Set<string>()
const nextAt = new Map<string, { version: number; at: number }>()
let generation = 0
const timers = new Set<ReturnType<typeof setTimeout>>()
let getAccountId: (() => string | null) | null = null
let onServiceGone: ((serviceRef: string) => void) | undefined

/** `fieldFor` names the field of a failure for the stored error text (the entry keeps its own field when it returns nothing). */
export function registerSender(kind: SaveKind, send: Sender, fieldFor?: FieldFor): void {
  senders.set(kind, send)
  if (fieldFor) fieldFors.set(kind, fieldFor)
  else fieldFors.delete(kind)
}

async function withLimit(send: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ApiError(0, 'timeout')), SEND_LIMIT_MS)
  })
  try {
    await Promise.race([send, limit])
  } finally {
    clearTimeout(timer)
  }
}

async function attempt(key: string): Promise<'ok' | 'failed'> {
  const e = listEntries().find((x) => x.key === key)
  if (!e) return 'ok'
  const send = senders.get(e.kind)
  if (!send || getAccountId?.() !== e.accountId) return 'failed'
  if (held(e)) return 'failed'
  const gen = generation
  try {
    await withLimit(send(e))
    nextAt.delete(key)
    const ref = listEntries().find((x) => x.key === key)?.serviceRef
    clearIfVersion(key, e.version)
    if (e.kind === 'service-create' && ref && ref !== e.serviceRef) void runGroup(ref, true) // the fields, now under the real id
    return 'ok'
  } catch (err) {
    markFailed(key, e.version, err, fieldFors.get(e.kind)?.(err))
    if (err instanceof ApiError && err.status === 404 && e.serviceRef) {
      dropService(e.serviceRef)
      try {
        onServiceGone?.(e.serviceRef)
      } catch {
        // a failing notice must not stop the runner
      }
      return 'failed'
    }
    const cur = listEntries().find((x) => x.key === key)
    if (gen === generation && cur && cur.version === e.version && cur.state === 'retry') {
      const delay = RETRY_SECONDS[Math.min(cur.attempts - 1, RETRY_SECONDS.length - 1)] * 1000
      nextAt.set(key, { version: e.version, at: Date.now() + delay })
      const timer = setTimeout(() => {
        timers.delete(timer)
        pump(false)
      }, delay)
      timers.add(timer)
    }
    return 'failed'
  }
}

/** One attempt for one entry. The only sender for a key: calls for one key run one after the other. */
export function sendNow(key: string): Promise<'ok' | 'failed'> {
  const run = () => attempt(key)
  const p = (locks.get(key) ?? Promise.resolve()).then(run, run)
  locks.set(key, p)
  const release = () => locks.get(key) === p && locks.delete(key)
  void p.then(release, release)
  return p
}

/** A field of a service not created yet waits for its create (also a refused one) and is never sent with `tmp:`. */
function held(e: PendingEntry): boolean {
  return e.kind !== 'service-create' && !!e.serviceRef?.startsWith('tmp:') && listEntries().some((x) => x.kind === 'service-create' && x.serviceRef === e.serviceRef)
}

function eligible(e: PendingEntry, everything: boolean): boolean {
  if (!senders.has(e.kind) || e.accountId !== getAccountId?.() || e.state === 'refused' || held(e)) return false
  if (everything) return true
  const due = nextAt.get(e.key)
  return e.state === 'retry' && !!due && due.version === e.version && due.at <= Date.now()
}

async function runGroup(group: string, everything: boolean) {
  const gen = generation
  if (running.has(group)) return
  running.add(group)
  const tried = new Map<string, number>()
  try {
    for (;;) {
      const mine = listEntries().filter((e) => (e.serviceRef ?? e.key) === group && tried.get(e.key) !== e.version)
      let next: PendingEntry | undefined
      for (const e of mine) {
        if (eligible(e, everything)) {
          next = e
          break
        }
        if (e.kind === 'service-create' && e.state !== 'refused') break
      }
      if (!next) return
      tried.set(next.key, next.version)
      if ((await sendNow(next.key)) !== 'ok') {
        const cur = listEntries().find((x) => x.key === next.key)
        if (gen !== generation || !cur || cur.version === next.version) return
        everything = true
      }
    }
  } finally {
    running.delete(group)
  }
}

function pump(everything: boolean) {
  const groups = new Set(listEntries().map((e) => e.serviceRef ?? e.key))
  for (const g of groups) void runGroup(g, everything)
}

export function wake(): void {
  pump(true)
}

export function startRunner(accountIdNow: () => string | null, opts?: { onServiceGone?: (serviceRef: string) => void }): () => void {
  let stopped = false
  getAccountId = accountIdNow
  onServiceGone = opts?.onServiceGone
  void loadStore().then(() => !stopped && pump(true))
  const sub = AppState.addEventListener('change', (st) => st === 'active' && pump(true))
  return () => {
    stopped = true
    sub.remove()
    timers.forEach(clearTimeout)
    timers.clear()
    generation++
    running.clear()
    locks.clear()
    nextAt.clear()
    getAccountId = null
    onServiceGone = undefined
  }
}
