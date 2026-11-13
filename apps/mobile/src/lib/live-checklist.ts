import { DOCUMENT_TYPES, type Missing, type MyProfile } from '@kando/contract'

import type { Key } from '@/i18n'
import { COMPULSORY } from './compulsory'
import type { DocumentRow } from './documents'
import { gateRows } from './quote-gate'

// Each missing item opens the screen that holds its field; on About you `?field=` puts the cursor in that field (the keyboard-aware scroll brings it into view).
const aboutRow = (field: keyof typeof COMPULSORY) => ({ label: COMPULSORY[field].label, path: `/my-profile/about?field=${field}` })
const ROW: Record<Missing, { label: Key; path: string }> = {
  name: { label: 'f.name', path: '/account' },
  service: { label: 'setup.services', path: '/my-profile/service/new' },
  providerType: aboutRow('providerType'),
  businessName: aboutRow('businessName'),
  impressum: aboutRow('impressum'),
  strengths: aboutRow('strengths'),
  skills: aboutRow('skills'),
  postcode: { label: 'search.postcode', path: '/account' }, // the base follows the account postcode
  radius: aboutRow('radius'),
}

type Progress = Pick<MyProfile, 'missing' | 'underCheck'>
type Row = { item: string; label: Key; path: string; state: 'open' | 'rejected' } | { item: string; label: Key; path?: undefined; state: 'checking' }
type OpenRow = Extract<Row, { path: string }>
type Doc = Pick<DocumentRow, 'requirement' | 'optional' | 'state'>

// A requirement under our check (or rejected) shows by its short document name; one this app version does not know is skipped.
const DOCS: readonly string[] = DOCUMENT_TYPES

/**
 * The first group: one open row per item the server still lists as missing, then one 'rejected' row per required document we did
 * not accept (needs action: it opens the document), then one 'checking' row per item we are checking (no screen to open); an item
 * this app version does not know is skipped.
 */
export const checklistItems = ({ missing, underCheck = [] }: Progress, docs: Doc[] = []): Row[] => [
  ...missing.filter((m) => m in ROW).map((item): Row => ({ item, ...ROW[item], state: 'open' as const })),
  ...docs.filter((d) => !d.optional && d.state === 'rejected' && DOCS.includes(d.requirement)).map((d): Row => ({ item: d.requirement, label: `doc.short.${d.requirement}` as Key, path: `/my-profile/document/${d.requirement}`, state: 'rejected' })),
  ...underCheck.filter((d) => DOCS.includes(d)).map((item): Row => ({ item, label: `doc.short.${item}` as Key, state: 'checking' })),
]

/** What still has to be done: rows under our check are left out. */
export const openItems = (rows: Row[]) => rows.filter((r): r is OpenRow => r.state === 'open')

/** Required documents we did not accept: each needs action (it opens the document). */
export const rejectedItems = (rows: Row[]) => rows.filter((r): r is OpenRow => r.state === 'rejected')

export const checklistHeading = (n: number): Key => (n === 1 ? 'setup.checklistOne' : 'setup.checklistMany')

/** Nothing is open for Live, no required document was rejected and no step remains before customers can book: the list becomes one green line. */
export const allSet = (profile: Progress, steps: MyProfile['quoteSteps'], docs: Doc[] = []) => steps !== undefined && checklistItems(profile, docs).every((r) => r.state === 'checking') && gateRows(steps).length === 0
