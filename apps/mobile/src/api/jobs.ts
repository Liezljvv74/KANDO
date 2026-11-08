import type { JobRow, JobsPage, Page } from '@kando/contract'

import type { Role } from '@/api/bookings'
import { api } from '@/api/client'
import { countsStore, type JobSection } from '@/lib/jobs'

/** One page of a Jobs section (or a search over all sections, `q`), as a `Page` for "Show more", with the role's counters. */
export async function getJobs(role: Role, opts: { section?: JobSection; q?: string; cursor?: string } = {}): Promise<Page<JobRow> & { counts: JobsPage['counts'] }> {
  const params = { role, section: opts.section, q: opts.q, cursor: opts.cursor }
  const query = Object.entries(params)
    .flatMap(([k, v]) => (v ? [`${k}=${encodeURIComponent(v)}`] : []))
    .join('&')
  const page = await api<JobsPage>(`/app-api/v1/jobs?${query}`)
  return { docs: page.items, next: page.next ?? null, counts: page.counts }
}

/** Both counters (tab badge and switch), from each side's "Needs you" page. */
export const jobCounts = countsStore((side) => getJobs(side, { section: 'needs_you' }))
