import { HELP_GROUPS, HELP_OPENING_SLUG, type HelpGroup, type HelpTopic } from '@kando/contract'

/** The Help screen's layout: the opening topic on its own, the others under their headings (the six headings in fixed order, empty ones left out). */
export function groupTopics(topics: HelpTopic[]): { opening: HelpTopic | null; groups: { group: HelpGroup; topics: HelpTopic[] }[] } {
  const sorted = [...topics].sort((a, b) => a.sort - b.sort || a.slug.localeCompare(b.slug))
  const opening = sorted.find((t) => t.slug === HELP_OPENING_SLUG) ?? null
  const rest = sorted.filter((t) => t !== opening)
  return { opening, groups: HELP_GROUPS.map((group) => ({ group, topics: rest.filter((t) => t.group === group) })).filter((g) => g.topics.length) }
}

/** Opens a closed topic and closes an open one; several can be open at once. */
export const toggleOpen = (open: ReadonlySet<string>, slug: string): Set<string> => {
  const next = new Set(open)
  if (!next.delete(slug)) next.add(slug)
  return next
}

/** The search box needs this many characters (the server refuses fewer), and at most 100 are sent. */
export const SEARCH_MIN_CHARS = 2
export const SEARCH_MAX_CHARS = 100
/** Wait this long after the last key press before searching. */
export const SEARCH_DEBOUNCE_MS = 300

/** What to search for from the text in the box, or null (show the normal list): trimmed, long enough, cut to the maximum. */
export function searchQuery(text: string): string | null {
  const q = text.trim().replace(/\s+/g, ' ')
  return [...q].length >= SEARCH_MIN_CHARS ? [...q].slice(0, SEARCH_MAX_CHARS).join('') : null
}

/** Calls `fn` with the last value given, `ms` after the last call; `cancel` drops a waiting call. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => clearTimeout(timer)
  const call = (...args: A) => {
    cancel()
    timer = setTimeout(() => fn(...args), ms)
  }
  return Object.assign(call, { cancel })
}

/** What the Help screen shows below the search box. */
export type SearchView = 'list' | 'loading' | 'error' | 'empty' | 'results'
export function searchView(query: string | null, state: { loading: boolean; error: string | null; topics: HelpTopic[] | null }): SearchView {
  if (!query) return 'list'
  if (state.error) return 'error'
  if (state.loading || !state.topics) return 'loading'
  return state.topics.length ? 'results' : 'empty'
}
