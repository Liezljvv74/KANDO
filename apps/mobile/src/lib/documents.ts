import { DOCUMENT_TYPES, type Category, type Document, type OwnService } from '@kando/contract'
import type { Key } from '@/i18n'

export type DocumentRow = { requirement: string; optional: boolean; state: 'none' | 'pending' | 'approved' | 'rejected'; note: string | null }

/**
 * One row per document the services' categories ask for, required ones first (a type required by any service counts as
 * required), then optional; each group in DOCUMENT_TYPES order, unknown codes last. Pending wins; else the latest reviewed
 * check decides, like `approvedDocuments` on the server.
 */
export function documentRows(services: OwnService[], categories: Category[], verifications: Document[]): DocumentRow[] {
  const required = new Set<string>()
  const optional = new Set<string>()
  for (const s of services) {
    const c = categories.find((c) => c.id === s.category)
    for (const r of c?.requiredDocuments ?? []) required.add(r)
    for (const r of c?.optionalDocuments ?? []) optional.add(r)
  }
  const reviewed = verifications
    .filter((v): v is Document & { status: 'approved' | 'rejected' } => v.status !== 'pending')
    .sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? '') || b.createdAt.localeCompare(a.createdAt))
  const rank = (r: string) => (DOCUMENT_TYPES as readonly string[]).indexOf(r) >>> 0 // unknown (-1) sorts last
  const inOrder = (set: Set<string>) => [...set].sort((a, b) => rank(a) - rank(b))
  const row = (requirement: string, isOptional: boolean): DocumentRow => {
    if (verifications.some((v) => v.requirement === requirement && v.status === 'pending')) return { requirement, optional: isOptional, state: 'pending', note: null }
    const latest = reviewed.find((v) => v.requirement === requirement)
    return { requirement, optional: isOptional, state: latest?.status ?? 'none', note: latest?.note ?? null }
  }
  return [...inOrder(required).map((r) => row(r, false)), ...inOrder(optional).filter((r) => !required.has(r)).map((r) => row(r, true))]
}

/** A hidden service's note: 'needed' while a document it waits for is missing or rejected, else 'waiting' (in staff review). */
export const serviceDocNote = (waitingFor: string[], rows: DocumentRow[]): 'needed' | 'waiting' =>
  waitingFor.some((r) => ['none', 'rejected'].includes(rows.find((d) => d.requirement === r)?.state ?? 'none')) ? 'needed' : 'waiting'

/** Share is offered only while no service waits for a document check (publish bar and banner alike). */
export const canShare = (services: OwnService[]) => !services.some((s) => (s.waitingFor ?? []).length > 0)

/** The submitted documents of one requirement, newest first (each can be deleted once another exists). */
export const submittedDocs = (requirement: string, verifications: Document[]) =>
  verifications.filter((v) => v.requirement === requirement).sort((a, b) => b.createdAt.localeCompare(a.createdAt))

/** The confirmation text before a delete: an approved document says that the services needing it go offline until the replacement is approved. */
export const deleteBodyKey = (status: Document['status']): Key => (status === 'approved' ? 'myProfile.docDeleteBody.approved' : 'myProfile.docDeleteBody')

export type DocTone = 'required' | 'optional' | 'pending' | 'approved'

/** A document row's colour: red while a compulsory one is not approved, orange for an optional one, neutral while in review, green when approved. */
export const docTone = (r: DocumentRow): DocTone => (r.state === 'approved' ? 'approved' : r.state === 'pending' ? 'pending' : r.optional ? 'optional' : 'required')

/** Text colours per tone, all readable (4.5:1 or more) on the white card. */
export const DOC_COLORS: Record<DocTone, string> = { required: '#B3261E', optional: '#9A5B00', pending: '#5C7A72', approved: '#0B7A5E' }
