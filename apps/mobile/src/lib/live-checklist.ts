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

/** The first group: one row per item the server still lists as missing; an item this app version does not know is skipped. */
export const checklistItems = (missing: Missing[]) => missing.filter((m) => m in ROW).map((item) => ({ item, ...ROW[item] }))

export const checklistHeading = (n: number): Key => (n === 1 ? 'setup.checklistOne' : 'setup.checklistMany')

/** Nothing is missing for Live and no step remains before customers can book: the list becomes one green line. */
export const allSet = (missing: Missing[], steps: MyProfile['quoteSteps']) => steps !== undefined && checklistItems(missing).length === 0 && gateRows(steps).length === 0
