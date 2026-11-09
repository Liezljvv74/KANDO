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
