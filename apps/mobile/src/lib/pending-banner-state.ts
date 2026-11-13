import { forAccount, type PendingEntry } from '@/lib/pending-saves'

export type BannerState =
  | { kind: 'retry'; reason: 'network' | 'busy' | 'auth' | 'waiting' }
  | { kind: 'refused'; count: number; first: PendingEntry }

/** The service-gone notice is cleared only when the account changes after the first render (`prev` undefined = first render). */
export const shouldClearGone = (prev: string | null | undefined, next: string | null) => prev !== undefined && prev !== next

/** The keys to remove when a refused change is discarded (`live` is read at the moment of confirming; none if the shown entry changed meanwhile): a service that can never be created takes its waiting field entries along. */
export function discardPlan(first: PendingEntry, live: PendingEntry[]): string[] {
  const mine = live.filter((e) => e.accountId === first.accountId)
  if (mine.find((e) => e.key === first.key)?.version !== first.version) return [] // gone, or edited again meanwhile: keep it
  if (first.kind !== 'service-create' || !first.serviceRef) return [first.key]
  return [first.key, ...mine.filter((e) => e.serviceRef === first.serviceRef && e.key !== first.key).map((e) => e.key)]
}

export function bannerState(all: PendingEntry[], accountId: string | null): BannerState | null {
  const mine = forAccount(all, accountId)
  const refused = mine.filter((e) => e.state === 'refused').sort((a, b) => a.createdAt - b.createdAt)
  if (refused.length) return { kind: 'refused', count: refused.length, first: refused[0] }
  // Only a change whose send has failed counts. One that is merely on its way (every keystroke stores one) shows nothing:
  // the bar would appear and vanish with each save and push the whole screen down and up.
  const failed = mine.filter((x) => x.attempts > 0 || x.status !== undefined)
  const e = failed.find((x) => x.state === 'auth') ?? failed.find((x) => x.state === 'waiting') ?? failed[0]
  if (!e) return null
  if (e.state === 'auth' || e.state === 'waiting') return { kind: 'retry', reason: e.state }
  return { kind: 'retry', reason: e.status === 0 || e.status === undefined ? 'network' : 'busy' }
}
