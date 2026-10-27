import type { MyProfile } from '@kando/contract'

import type { ApiError } from '@/api/client'
import type { Key } from '@/i18n'

// Same limits as the server (packages/contract: ProfileInputSchema, ServiceInputSchema, ReferenceInputSchema).
export const MAX_SKILLS = 20
export const MAX_SKILL_LENGTH = 50
/** Mirrors the server's strengths maxLength (the list is saved one per line). */
export const MAX_STRENGTHS_TEXT = 1000

export type ProfileForm = {
  /** The account name (first and last name), saved with PATCH /me, not with the profile. */
  name: string
  providerType: 'individual' | 'business'
  businessName: string
  impressum: string
  bio: string
  strengths: string[]
  skills: string[]
  /** Free text in the provider's words, e.g. "Seit 2010 selbstständig". */
  experience: string
  basePostcode: string
  serviceRadiusKm: string
  worksRemotely: boolean
}

/** Error message key per field name. */
export type Errors = Record<string, Key>

export const emptyProfile: ProfileForm = {
  name: '',
  providerType: 'individual',
  businessName: '',
  impressum: '',
  bio: '',
  strengths: [],
  skills: [],
  experience: '',
  basePostcode: '',
  serviceRadiusKm: '25',
  worksRemotely: false,
}

const LIMITS: [keyof ProfileForm, number][] = [
  ['name', 100],
  ['businessName', 120],
  ['impressum', 1000],
  ['bio', 2000],
  ['experience', 500],
]

const whole = (text: string, min: number, max: number) => /^\d{1,4}$/.test(text) && +text >= min && +text <= max

export function validateProfile(f: ProfileForm): Errors {
  const e: Errors = {}
  if (!f.name.trim()) e.name = 'form.required'
  if (f.providerType === 'business' && !f.businessName.trim()) e.businessName = 'form.required'
  for (const [name, max] of LIMITS) if (!e[name] && (f[name] as string).trim().length > max) e[name] = 'form.tooLong'
  const badList = (l: string[]) => l.length > MAX_SKILLS || l.some((s) => !s.length || s.length > MAX_SKILL_LENGTH)
  if (badList(f.skills)) e.skills = 'f.skillsError'
  // Strengths follow the skills limits and are saved one per line in a 1000-character text field (line breaks count).
  if (badList(f.strengths)) e.strengths = 'f.strengthsError'
  else if (f.strengths.join('\n').length > MAX_STRENGTHS_TEXT) e.strengths = 'form.tooLong'
  if (f.basePostcode.trim() && !/^\d{5}$/.test(f.basePostcode.trim())) e.basePostcode = 'search.postcodeInvalid'
  if (!whole(f.serviceRadiusKm.trim(), 1, 200)) e.serviceRadiusKm = 'f.radiusError'
  return e
}

/** PUT body. Empty text is sent as '' (the server clears the field). */
export function profileBody(f: ProfileForm) {
  return {
    providerType: f.providerType,
    businessName: f.providerType === 'business' ? f.businessName.trim() : '',
    impressum: f.providerType === 'business' ? f.impressum.trim() : '',
    bio: f.bio.trim(),
    // Stored one per line in the existing text field.
    strengths: f.strengths.join('\n'),
    skills: f.skills,
    experience: f.experience.trim(),
    basePostcode: f.basePostcode.trim(),
    serviceRadiusKm: Number(f.serviceRadiusKm),
    worksRemotely: f.worksRemotely,
  }
}

/** The trimmed new account name, or null when it did not change. */
export function nameChange(f: ProfileForm, current: string): string | null {
  const name = f.name.trim()
  return name === current ? null : name
}

/** `accountName` is the session user's name (the form's first field). */
export function profileFromDoc(d: Partial<MyProfile> | null, accountName = ''): ProfileForm {
  if (!d) return { ...emptyProfile, name: accountName }
  return {
    name: accountName,
    providerType: d.providerType === 'business' ? 'business' : 'individual',
    businessName: d.businessName ?? '',
    impressum: d.impressum ?? '',
    bio: d.bio ?? '',
    // Unique: staff may have typed a line twice in the admin panel.
    strengths: [...new Set<string>((d.strengths ?? '').split('\n').map((s: string) => s.trim()).filter(Boolean))],
    skills: Array.isArray(d.skills) ? d.skills.filter((s: unknown) => typeof s === 'string') : [],
    experience: d.experience ?? '',
    basePostcode: d.basePostcode ?? '',
    serviceRadiusKm: String(d.serviceRadiusKm ?? 25),
    worksRemotely: !!d.worksRemotely,
  }
}

/** Server 400 -> field errors: 'Invalid fields'/'Invalid input' list names, 'Unknown postcode' belongs to the postcode field. */
export function serverFieldErrors(e: ApiError): Errors {
  const out: Errors = {}
  if (e.status !== 400) return out
  if (e.code === 'Unknown postcode') out.basePostcode = 'error.unknownPostcode'
  for (const f of e.fields ?? []) out[f] = 'form.invalid'
  return out
}

/** `list` with `text` (trimmed) added; unchanged when blank or already there. For skills and strengths. */
export function withItem(list: string[], text: string): string[] {
  const s = text.trim()
  return s && !list.includes(s) ? [...list, s] : list
}

/** True unless every server error can show next to its field (`shown` = fields with an inline error slot). */
export const needsFormError = (errors: Errors, shown: string[]) => {
  const keys = Object.keys(errors)
  return !keys.length || keys.some((k) => !shown.includes(k))
}

/** "12,5" and "12.50" both count; null when not a price of 0 or more with at most 2 decimals. */
export function parsePrice(text: string): number | null {
  const s = text.trim().replace(',', '.')
  return /^\d{1,7}(\.\d{1,2})?$/.test(s) ? Number(s) : null
}

export type ServiceForm = { category: string | null; title: string; description: string; priceType: string; price: string }

export function validateService(f: ServiceForm): Errors {
  const e: Errors = {}
  if (f.category == null) e.category = 'form.required'
  if (!f.title.trim()) e.title = 'form.required'
  else if (f.title.length > 120) e.title = 'form.tooLong'
  if (f.description.length > 2000) e.description = 'form.tooLong'
  if (f.priceType !== 'on-request' && parsePrice(f.price) === null) e.price = 's.priceError'
  return e
}

export const serviceBody = (f: ServiceForm) => ({
  categoryId: f.category,
  title: f.title.trim(),
  description: f.description.trim(),
  priceType: f.priceType,
  price: f.priceType === 'on-request' ? null : parsePrice(f.price),
  currency: 'EUR',
})

export type ReferenceForm = { clientName: string; description: string; year: string }

export function validateReference(f: ReferenceForm, now = new Date().getFullYear()): Errors {
  const e: Errors = {}
  if (!f.clientName.trim()) e.clientName = 'form.required'
  else if (f.clientName.length > 120) e.clientName = 'form.tooLong'
  if (!f.description.trim()) e.description = 'form.required'
  else if (f.description.length > 1000) e.description = 'form.tooLong'
  const y = f.year.trim()
  if (y && !(/^\d{4}$/.test(y) && +y >= 1970 && +y <= now)) e.year = 'r.yearError'
  return e
}

export const referenceBody = (f: ReferenceForm) => ({
  clientName: f.clientName.trim(),
  description: f.description.trim(),
  year: f.year.trim() === '' ? null : Number(f.year),
})
