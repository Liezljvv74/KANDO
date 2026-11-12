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

const entries = new Map<string, PendingEntry>() // by account + key: one phone, several accounts, the same keys
const idOf = (accountId: string, key: string) => `${accountId} ${key}`
const listeners = new Set<() => void>()
let snapshot: PendingEntry[] = []
let lastVersion = 0
let writeQueued = false
let writing: Promise<void> = Promise.resolve()
let loaded = false
let readFailed = false
let finishLoad: () => void = () => {}
const loadDone = new Promise<void>((resolve) => (finishLoad = resolve))
const removedKeys = new Set<string>()
const droppedAccounts = new Set<string>()
const renamed = new Map<string, string>() // temporary service id -> real id, for a value put after the rename
const KINDS = ['about', 'service-field', 'service-create', 'account']
const STATES = ['retry', 'refused', 'auth', 'waiting']

export function classifyFailure(e: unknown): FailureState {
  const status = e instanceof ApiError ? e.status : 0
  if (status === 401) return 'auth'
  if (status === 403 || status === 428) return 'waiting'
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) return 'refused'
  return 'retry'
}

function changed(persistToo = true) {
  snapshot = [...entries.values()].sort((a, b) => a.version - b.version)
  listeners.forEach((fn) => fn())
  if (persistToo) schedulePersist()
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
  await loadDone
  if (readFailed) {
    readFailed = false
    return
  }
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
  const to = e.serviceRef && renamed.get(e.serviceRef)
  if (to) e = { ...e, key: e.key.split(`service:${e.serviceRef}:`).join(`service:${to}:`), serviceRef: to, route: routeFor(e.route, to) }
  const now = Date.now()
  lastVersion = Math.max(lastVersion + 1, now)
  entries.set(idOf(e.accountId, e.key), { ...e, version: lastVersion, state: 'retry', attempts: 0, createdAt: now })
  changed()
  return lastVersion
}

/** Versions are unique across accounts, so key + version names one entry. */
function byVersion(key: string, version: number): PendingEntry | undefined {
  for (const e of entries.values()) if (e.key === key && e.version === version) return e
}

export function clearIfVersion(key: string, version: number) {
  const cur = byVersion(key, version)
  if (cur) removeKey(key, cur.accountId)
}

export function markFailed(key: string, version: number, e: unknown, field?: string) {
  const cur = byVersion(key, version)
  if (!cur) return
  entries.set(idOf(cur.accountId, key), {
    ...cur,
    state: classifyFailure(e),
    reason: e instanceof Error ? e.message : String(e),
    status: e instanceof ApiError ? e.status : 0,
    attempts: cur.attempts + 1,
    field: field ?? cur.field,
  })
  changed()
}

export function removeKey(key: string, accountId: string) {
  const id = idOf(accountId, key)
  if (!loaded) removedKeys.add(id)
  if (entries.delete(id)) changed()
}

export function dropAccount(accountId: string) {
  if (!loaded) droppedAccounts.add(accountId)
  let any = false
  for (const [k, e] of entries) if (e.accountId === accountId) any = entries.delete(k) || any
  if (any) changed()
}

const deletedByPerson = new Set<string>()
export const wasDeletedByPerson = (serviceRef: string) => deletedByPerson.has(serviceRef)

/** `byPerson`: the person deleted the service, so a late 404 for it is no news to them. */
export function dropService(serviceRef: string, byPerson = false) {
  if (byPerson) deletedByPerson.add(serviceRef)
  for (const e of snapshot) if (e.serviceRef === serviceRef) removeKey(e.key, e.accountId)
}

const routeFor = (route: string, serviceId: string) => (route === '/my-profile/service/new' ? `/my-profile/service/${serviceId}` : route)

export function replaceServiceRef(from: string, to: string) {
  if (from.startsWith('tmp:')) renamed.set(from, to)
  let any = false
  for (const [k, e] of [...entries]) {
    if (e.serviceRef !== from) continue
    entries.delete(k)
    const key = e.key.split(`service:${from}:`).join(`service:${to}:`)
    const id = idOf(e.accountId, key)
    const other = entries.get(id)
    if (!other || other.version < e.version) entries.set(id, { ...e, key, serviceRef: to, route: routeFor(e.route, to) })
    any = true
  }
  if (any) changed()
}

export function listEntries(accountId?: string): PendingEntry[] {
  return accountId === undefined ? snapshot : snapshot.filter((e) => e.accountId === accountId)
}

function isValid(e: PendingEntry): boolean {
  return (
    !!e &&
    typeof e.key === 'string' &&
    typeof e.accountId === 'string' &&
    typeof e.version === 'number' &&
    typeof e.createdAt === 'number' &&
    typeof e.attempts === 'number' &&
    typeof e.route === 'string' &&
    typeof e.field === 'string' &&
    KINDS.includes(e.kind) &&
    STATES.includes(e.state)
  )
}

export async function loadStore(): Promise<void> {
  try {
    let stored: unknown = []
    try {
      const file = new File(Paths.document, FILE)
      if (file.exists) stored = JSON.parse(await file.text())
    } catch (err) {
      if (!(err instanceof SyntaxError)) readFailed = true
    }
    if (!Array.isArray(stored)) return
    const now = Date.now()
    for (const e of stored as PendingEntry[]) {
      if (!isValid(e) || now - e.createdAt > MAX_AGE_MS) continue
      const id = idOf(e.accountId, e.key)
      if (removedKeys.has(id) || droppedAccounts.has(e.accountId)) continue
      const mine = entries.get(id)
      if (!mine || mine.version < e.version) entries.set(id, e)
      lastVersion = Math.max(lastVersion, e.version)
    }
    changed(false)
  } finally {
    loaded = true
    removedKeys.clear()
    droppedAccounts.clear()
    finishLoad()
  }
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

const getSnapshot = () => snapshot

export function forAccount(all: PendingEntry[], accountId: string | null): PendingEntry[] {
  return accountId === null ? [] : all.filter((e) => e.accountId === accountId)
}

export function usePendingEntries(accountId: string | null): PendingEntry[] {
  const all = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(() => forAccount(all, accountId), [all, accountId])
}

export const findEntry = (all: PendingEntry[], key: string, accountId: string | null): PendingEntry | undefined =>
  all.find((e) => e.key === key && e.accountId === accountId)

/** The kept entry of this account only: another account on the same phone has the same keys. */
export function usePendingEntry(key: string, accountId: string | null): PendingEntry | undefined {
  const all = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(() => findEntry(all, key, accountId), [all, key, accountId])
}
