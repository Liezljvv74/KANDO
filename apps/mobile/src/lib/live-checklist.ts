import type { Missing, MyProfile } from '@kando/contract'

import type { Key } from '@/i18n'
import { COMPULSORY } from './compulsory'
import { gateRows } from './quote-gate'

// Each missing item opens the screen that holds its field (the setup page has no scroll-to-field, so a card's own edit screen is the target).
const aboutRow = (field: keyof typeof COMPULSORY) => ({ label: COMPULSORY[field].label, path: '/my-profile/about' })
const ROW: Record<Missing, { label: Key; path: string }> = {
  name: { label: 'f.name', path: '/account' },
  service: { label: 'setup.services', path: '/my-profile/service/new' },
  providerType: aboutRow('providerType'),
  businessName: aboutRow('businessName'),
  impressum: aboutRow('impressum'),
  strengths: aboutRow('strengths'),
  skills: aboutRow('skills'),
  postcode: aboutRow('postcode'),
  radius: aboutRow('radius'),
}

type Progress = Pick<MyProfile, 'missing' | 'underCheck'>
type Row = { item: string; label: Key; path: string | undefined; state: 'open' | 'checking' }

// A requirement under our check shows by its short document name; one this app version does not know is skipped.
const DOCS = ['id-document', 'trade-registration', 'liability-insurance', 'police-certificate', 'hygiene-certificate', 'food-business-registration', 'permit', 'craft-qualification', 'first-aid-certificate']

/** The first group: one open row per item the server still lists as missing, then one 'checking' row per item we are checking (no screen to open); an item this app version does not know is skipped. */
export const checklistItems = ({ missing, underCheck = [] }: Progress): Row[] => [
  ...missing.filter((m) => m in ROW).map((item): Row => ({ item, ...ROW[item], state: 'open' })),
  ...underCheck.filter((d) => DOCS.includes(d)).map((item): Row => ({ item, label: `doc.short.${item}` as Key, path: undefined, state: 'checking' })),
]

/** What still has to be done: rows under our check are left out. */
export const openItems = (rows: Row[]) => rows.filter((r) => r.state === 'open')

export const checklistHeading = (n: number): Key => (n === 1 ? 'setup.checklistOne' : 'setup.checklistMany')

/** Nothing is open for Live and no step remains before customers can book: the list becomes one green line. */
export const allSet = (profile: Progress, steps: MyProfile['quoteSteps']) => steps !== undefined && openItems(checklistItems(profile)).length === 0 && gateRows(steps).length === 0
