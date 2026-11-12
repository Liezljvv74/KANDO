import { File, Paths } from 'expo-file-system'
import { useMemo, useSyncExternalStore } from 'react'
import { ApiError } from '@/api/client'

export type SaveKind = 'about' | 'service-field' | 'service-create' | 'account'
export type FailureState = 'retry' | 'refused' | 'auth' | 'waiting'

export type PendingEntry = {
  key: string
  kind: SaveKind
  accountId: string
  body: unknown
  serviceRef?: string
  route: string
  field: string
  version: number
  state: FailureState
  reason?: string
  status?: number
  attempts: number
  createdAt: number
}

const FILE = 'pending-saves.json'
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const entries = new Map<string, PendingEntry>()
const listeners = new Set<() => void>()
let snapshot: PendingEntry[] = []
let lastVersion = 0
let writeQueued = false
let writing: Promise<void> = Promise.resolve()

export function classifyFailure(e: unknown): FailureState {
  const status = e instanceof ApiError ? e.status : 0
  if (status === 401) return 'auth'
  if (status === 403 || status === 428) return 'waiting'
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return 'refused'
  return 'retry'
}

function changed() {
  snapshot = [...entries.values()].sort((a, b) => a.version - b.version)
  listeners.forEach((fn) => fn())
  schedulePersist()
}

function schedulePersist() {
  if (writeQueued) return
  writeQueued = true
  void Promise.resolve().then(() => {
    writeQueued = false
    writing = writing.then(persist, persist)
  })
}

async function persist() {
  try {
    const tmp = new File(Paths.document, `${FILE}.tmp`)
    if (!tmp.exists) tmp.create()
    await tmp.write(JSON.stringify(snapshot))
    await tmp.move(new File(Paths.document, FILE), { overwrite: true })
  } catch {
    // the next change writes again; the in-memory copy stays the truth
  }
}

export function putEntry(e: Omit<PendingEntry, 'version' | 'attempts' | 'state' | 'createdAt' | 'status' | 'reason'>): number {
  const now = Date.now()
  lastVersion = Math.max(lastVersion + 1, now)
  entries.set(e.key, { ...e, version: lastVersion, state: 'retry', attempts: 0, createdAt: now })
  changed()
  return lastVersion
}

export function clearIfVersion(key: string, version: number) {
  if (entries.get(key)?.version !== version) return
  entries.delete(key)
  changed()
}

export function markFailed(key: string, version: number, e: unknown, field?: string) {
  const cur = entries.get(key)
  if (!cur || cur.version !== version) return
  entries.set(key, {
    ...cur,
    state: classifyFailure(e),
    reason: e instanceof Error ? e.message : String(e),
    status: e instanceof ApiError ? e.status : 0,
    attempts: cur.attempts + 1,
    field: field ?? cur.field,
  })
  changed()
}

export function removeKey(key: string) {
  if (entries.delete(key)) changed()
}

export function dropAccount(accountId: string) {
  let any = false
  for (const [k, e] of entries) if (e.accountId === accountId) any = entries.delete(k) || any
  if (any) changed()
}

export function replaceServiceRef(from: string, to: string) {
  let any = false
  for (const [k, e] of [...entries]) {
    if (e.serviceRef !== from) continue
    entries.delete(k)
    const key = k.replace(`service:${from}:`, `service:${to}:`)
    const other = entries.get(key)
    if (!other || other.version < e.version) entries.set(key, { ...e, key, serviceRef: to })
    any = true
  }
  if (any) changed()
}

export function listEntries(accountId?: string): PendingEntry[] {
  return accountId === undefined ? snapshot : snapshot.filter((e) => e.accountId === accountId)
}

export async function loadStore(): Promise<void> {
  let stored: unknown = []
  try {
    const file = new File(Paths.document, FILE)
    if (file.exists) stored = JSON.parse(await file.text())
  } catch {
    stored = []
  }
  if (!Array.isArray(stored)) return
  const now = Date.now()
  for (const e of stored as PendingEntry[]) {
    const ok = e && typeof e.key === 'string' && typeof e.accountId === 'string' && typeof e.version === 'number' && typeof e.createdAt === 'number'
    if (!ok || now - e.createdAt > MAX_AGE_MS) continue
    const mine = entries.get(e.key)
    if (!mine || mine.version < e.version) entries.set(e.key, e)
    lastVersion = Math.max(lastVersion, e.version)
  }
  changed()
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

const getSnapshot = () => snapshot

export function usePendingEntries(accountId: string | null): PendingEntry[] {
  const all = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(() => (accountId === null ? [] : all.filter((e) => e.accountId === accountId)), [all, accountId])
}

export function usePendingEntry(key: string): PendingEntry | undefined {
  const all = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(() => all.find((e) => e.key === key), [all, key])
}
