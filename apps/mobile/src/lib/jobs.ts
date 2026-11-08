import type { JOB_SECTIONS, JobsPage } from '@kando/contract'

export type JobSection = (typeof JOB_SECTIONS)[number]
type Side = 'customer' | 'provider'

/** One side's counter: jobs that need me or have an unread message, each job once (the server counts it so). */
export const counterOf = (counts: JobsPage['counts'] | undefined): number => counts?.needsYou ?? 0

/** The Jobs tab badge: the customer and the provider counter added. */
export const tabBadge = (counts: { customer: number; provider: number }): number => counts.customer + counts.provider

/** "Past jobs" is folded until opened: folded, its rows are not fetched at all (only its count, which every page carries). */
export const pastPage = async <P>(open: boolean, load: () => Promise<P>): Promise<P | undefined> => (open ? load() : undefined)

/**
 * The one source of both counters, read by the tab badge and the Jobs switch. `load(sides)` fetches each side's "Needs you" page
 * (the Jobs screen shows its rows, so the counters cost no extra call there) and writes the counters; a side not asked for is 0.
 * Callers in the same moment (the tabs layout and the Jobs screen both refresh on focus and on app foreground) asking for the same
 * sides share one flight; other sides start a new one. Only the newest load writes, and nothing started before a `clear` does.
 */
export function countsStore<P extends { counts: JobsPage['counts'] }>(fetchSide: (side: Side) => Promise<P>) {
  let state = { customer: 0, provider: 0 }
  let flight: { key: string; pages: Promise<Partial<Record<Side, P>>> } | null = null
  let gen = 0 // bumped by every new flight and by clear: an older answer goes back to its caller but is never written
  const listeners = new Set<() => void>()
  const write = (next: typeof state) => {
    if (next.customer === state.customer && next.provider === state.provider) return
    state = next
    listeners.forEach((l) => l())
  }
  return {
    get: () => state,
    subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)),
    /** Signed out: no counters, and a load still on its way (the old account's) writes nothing. */
    clear: () => {
      gen++
      flight = null
      write({ customer: 0, provider: 0 })
    },
    load(sides: Side[]): Promise<Partial<Record<Side, P>>> {
      const key = sides.join()
      if (flight?.key === key) return flight.pages
      const mine = ++gen
      const pages: Promise<Partial<Record<Side, P>>> = Promise.all(sides.map(fetchSide))
        .then((got) => {
          const by: Partial<Record<Side, P>> = Object.fromEntries(sides.map((s, i) => [s, got[i]]))
          if (mine === gen) write({ customer: counterOf(by.customer?.counts), provider: counterOf(by.provider?.counts) })
          return by
        })
        .finally(() => {
          if (flight?.pages === pages) flight = null
        })
      flight = { key, pages }
      return pages
    },
  }
}
