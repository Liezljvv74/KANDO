import { forAccount, type PendingEntry } from '@/lib/pending-saves'

export type BannerState =
  | { kind: 'retry'; reason: 'network' | 'busy' | 'auth' | 'waiting' }
  | { kind: 'refused'; count: number; first: PendingEntry }

export function bannerState(all: PendingEntry[], accountId: string | null): BannerState | null {
  const mine = forAccount(all, accountId)
  const refused = mine.filter((e) => e.state === 'refused').sort((a, b) => a.createdAt - b.createdAt)
  if (refused.length) return { kind: 'refused', count: refused.length, first: refused[0] }
  const e = mine.find((x) => x.state === 'auth') ?? mine.find((x) => x.state === 'waiting') ?? mine[0]
  if (!e) return null
  if (e.state === 'auth' || e.state === 'waiting') return { kind: 'retry', reason: e.state }
  return { kind: 'retry', reason: e.status === 0 || e.status === undefined ? 'network' : 'busy' }
}
