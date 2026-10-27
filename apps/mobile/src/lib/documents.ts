import type { Category, Document, OwnService } from '@kando/contract'

/** Mirrors VERIFICATION_REQUIREMENTS on the server (display order). */
export const VERIFICATION_REQUIREMENTS = ['police-certificate', 'permit']

export type DocumentRow = { requirement: string; state: 'none' | 'pending' | 'approved' | 'rejected'; note: string | null }

/** One row per document the services' categories require. Pending wins; else the latest reviewed check decides, like `approvedDocuments` on the server. */
export function documentRows(services: OwnService[], categories: Category[], verifications: Document[]): DocumentRow[] {
  const needed = new Set<string>()
  for (const s of services) for (const r of categories.find((c) => c.id === s.category)?.requiredDocuments ?? []) needed.add(r)
  const reviewed = verifications
    .filter((v): v is Document & { status: 'approved' | 'rejected' } => v.status !== 'pending')
    .sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? '') || b.createdAt.localeCompare(a.createdAt))
  const known = VERIFICATION_REQUIREMENTS.filter((r) => needed.has(r))
  return [...known, ...[...needed].filter((r) => !VERIFICATION_REQUIREMENTS.includes(r))].map((requirement): DocumentRow => {
    if (verifications.some((v) => v.requirement === requirement && v.status === 'pending')) return { requirement, state: 'pending', note: null }
    const latest = reviewed.find((v) => v.requirement === requirement)
    return { requirement, state: latest?.status ?? 'none', note: latest?.note ?? null }
  })
}

/** A hidden service's note: 'needed' while a document it waits for is missing or rejected, else 'waiting' (in staff review). */
export const serviceDocNote = (waitingFor: string[], rows: DocumentRow[]): 'needed' | 'waiting' =>
  waitingFor.some((r) => ['none', 'rejected'].includes(rows.find((d) => d.requirement === r)?.state ?? 'none')) ? 'needed' : 'waiting'

/** Share is offered only while no service waits for a document check (publish bar and banner alike). */
export const canShare = (services: OwnService[]) => !services.some((s) => (s.waitingFor ?? []).length > 0)
