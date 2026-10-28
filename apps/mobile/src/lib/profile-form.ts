import type { ApiError } from '@/api/client'
import type { Key } from '@/i18n'

// Same limits as the server (packages/contract: ProfileInputSchema, ServiceInputSchema, ReferenceInputSchema).
export const MAX_SKILLS = 20
export const MAX_SKILL_LENGTH = 50

/** Error message key per field name. */
export type Errors = Record<string, Key>

/** Server 400 -> field errors: 'Invalid fields'/'Invalid input' list names, 'Unknown postcode' belongs to the postcode field. */
export function serverFieldErrors(e: ApiError): Errors {
  const out: Errors = {}
  if (e.status !== 400) return out
  if (e.code === 'Unknown postcode') out.basePostcode = 'error.unknownPostcode'
  for (const f of e.fields ?? []) out[f] = 'form.invalid'
  return out
}

/** Published and not suspended right now: when the profile shows in search (same rule as the server's listServices). */
export const isLive = (p: { status: string; suspendedUntil: string | null }, now = new Date()) =>
  p.status === 'published' && !(p.suspendedUntil && new Date(p.suspendedUntil) > now)

/** `list` with `text` (trimmed) added; unchanged when blank or already there. For skills and strengths. */
export function withItem(list: string[], text: string): string[] {
  const s = text.trim()
  return s && !list.includes(s) ? [...list, s] : list
}

/**
 * A typed tag that was not added yet: the new list, or null when there is nothing to add or a limit stops it
 * (`tooLong` then, for the error). Limits: tags per list, characters per tag, characters of the joined list.
 */
export function typedTag(list: string[], text: string, max: number, maxLength: number, maxJoined: number): { list: string[] | null; tooLong: boolean } {
  const next = withItem(list, text)
  if (next === list) return { list: null, tooLong: false }
  const over = next.length > max || text.trim().length > maxLength || next.join('\n').length > maxJoined
  return { list: over ? null : next, tooLong: over }
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
