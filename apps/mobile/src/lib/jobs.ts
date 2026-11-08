import type { JOB_SECTIONS, JobsPage } from '@kando/contract'

export type JobSection = (typeof JOB_SECTIONS)[number]

/** One side's counter: jobs that need me or have an unread message, each job once (the server counts it so). */
export const counterOf = (counts: JobsPage['counts'] | undefined): number => counts?.needsYou ?? 0

/** The Jobs tab badge: the customer and the provider counter added. */
export const tabBadge = (counts: { customer: number; provider: number }): number => counts.customer + counts.provider

/** The sections whose rows are loaded: "Past jobs" stays folded (only its count) until opened. */
export const sectionsToLoad = (pastOpen = false): JobSection[] => (pastOpen ? ['needs_you', 'active', 'past'] : ['needs_you', 'active'])
