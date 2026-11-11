import { t, type Key } from '@/i18n'

import { COMPULSORY } from './compulsory'
import { parsePrice } from './profile-form'

const empty = (s: string) => !s.trim()
const L = (f: keyof typeof COMPULSORY) => COMPULSORY[f].label

/** What is still empty on the account screen: name and postcode, plus the date of birth for a provider. */
export const accountMissing = (v: { firstName: string; lastName: string; postcode: string; hasBirthDate: boolean; isProvider: boolean }): Key[] => {
  const k: Key[] = []
  if (empty(v.firstName)) k.push('auth.firstName')
  if (empty(v.lastName)) k.push('auth.lastName')
  if (empty(v.postcode)) k.push(L('postcode'))
  if (v.isProvider && !v.hasBirthDate) k.push('auth.birthDate')
  return k
}

/** What is still empty on About you; business name and legal notice are for businesses only. */
export const aboutMissing = (v: { providerType: string | null; businessName: string; impressum: string; strengths: string[]; skills: string[]; postcode: string; radiusValid: boolean }): Key[] => {
  const k: Key[] = []
  if (!v.providerType) k.push(L('providerType'))
  if (v.providerType === 'business') {
    if (empty(v.businessName)) k.push(L('businessName'))
    if (empty(v.impressum)) k.push(L('impressum'))
  }
  if (!v.strengths.length) k.push(L('strengths'))
  if (!v.skills.length) k.push(L('skills'))
  if (empty(v.postcode)) k.push(L('postcode'))
  if (!v.radiusValid) k.push(L('radius'))
  return k
}

/** What is still empty on a service; the price is needed unless the price type is on-request (server rule). */
export const serviceMissing = (v: { category: string | null; priceType: string | null; price: string }): Key[] => {
  const k: Key[] = []
  if (!v.category) k.push(L('category'))
  if (!v.priceType) k.push(L('priceType'))
  if (v.priceType !== 'on-request' && parsePrice(v.price) === null) k.push(L('price')) // empty or not a valid amount
  return k
}

export const missingMessage = (keys: Key[]): string => t('flow.missing', { fields: keys.map((k) => t(k)).join(', ') })
