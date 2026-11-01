import type { TimeProposal } from '@kando/contract'

import { EMPTY_ADDRESS, type AddressInput } from '@/components/address-fields'
import { toMinutes } from '@/lib/booking-time'

/** The "when and where" of a request, a counter or an entered time: one Date holds the day and the time of day. */
export type WhenWhere = { when: Date | null; duration: string; onSite: boolean; address: AddressInput; note: string }

export const emptyWhenWhere = (address: AddressInput = EMPTY_ADDRESS): WhenWhere => ({ when: null, duration: '60', onSite: true, address, note: '' })

/** Where a picker opens when nothing was chosen yet: tomorrow at 09:00. */
export function suggestedWhen(now = new Date()): Date {
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d
}

/** The chosen day with the time of day kept (09:00 when there is none yet). */
export function withDay(current: Date | null, picked: Date): Date {
  const base = current ?? suggestedWhen(picked)
  const d = new Date(picked)
  d.setHours(base.getHours(), base.getMinutes(), 0, 0)
  return d
}

/** The chosen time of day with the day kept (tomorrow when there is none yet). */
export function withTimeOfDay(current: Date | null, picked: Date): Date {
  const base = current ?? suggestedWhen()
  const d = new Date(base)
  d.setHours(picked.getHours(), picked.getMinutes(), 0, 0)
  return d
}

/** The provider's answer starts from the customer's time (empty when the request has none, an old request). */
export function whenFromRequest(r: { startAt: string | null; durationMin: number | null }): WhenWhere {
  const empty = emptyWhenWhere()
  return r.startAt ? { ...empty, when: new Date(r.startAt), duration: String(r.durationMin ?? 60) } : empty
}

export type ProposalError = 'invalid-time' | 'start-in-past' | 'address-required'
export type BuildResult = { ok: true; proposal: TimeProposal } | { ok: false; error: ProposalError }

/**
 * The proposal the server takes, from the form: the start and the duration must be there; an on-site job with details needs the
 * postcode at least (the server's rule, said before the trip), and the start must be in the future (the day and the time are chosen
 * separately, so a past time today is possible). `canRemote`: the person may choose remote (else it is on site);
 * `withDetails`: the address and the note are asked (not for a counter or an entered time).
 */
export function buildProposal(v: WhenWhere, o: { canRemote: boolean; withDetails: boolean }, now = new Date()): BuildResult {
  const durationMin = toMinutes(v.duration)
  if (!v.when || Number.isNaN(v.when.getTime()) || durationMin === null) return { ok: false, error: 'invalid-time' }
  if (v.when.getTime() <= now.getTime()) return { ok: false, error: 'start-in-past' }
  const onSite = !o.canRemote || v.onSite
  const postcode = v.address.postcode.trim()
  if (o.withDetails && onSite && !postcode) return { ok: false, error: 'address-required' }
  const street = v.address.street.trim()
  const city = v.address.city.trim()
  const note = v.note.trim()
  return {
    ok: true,
    proposal: {
      startAt: v.when.toISOString(),
      durationMin,
      onSite,
      ...(o.withDetails && onSite && { address: { postcode, ...(street && { street }), ...(city && { city }) } }),
      ...(o.withDetails && note && { note }),
    },
  }
}

export type QuoteTimeResult = { ok: true; time: { startAt: string; durationMin: number } | null } | { ok: false; error: ProposalError }

/** The time a quote carries: none when "date and time confirmed" is off (the quote says "to be confirmed"), else the checked start and duration. */
export function buildQuoteTime(v: WhenWhere, confirmed: boolean, now = new Date()): QuoteTimeResult {
  if (!confirmed) return { ok: true, time: null }
  const built = buildProposal(v, { canRemote: false, withDetails: false }, now)
  return built.ok ? { ok: true, time: { startAt: built.proposal.startAt, durationMin: built.proposal.durationMin } } : { ok: false, error: built.error }
}
