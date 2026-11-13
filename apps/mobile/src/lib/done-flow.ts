import type { Key } from '@/i18n'

import { finishFlow } from './finish-flow'
import { flowCache, nextStepHeld, type Step } from './flow-cache'
import { loadNextStep, payoutNotReady } from './flow-state'
import { goBack, goReplace } from './go'
import type { NextStep } from './next-step'

export type DoneOutcome =
  | { type: 'missing'; fields: Key[] }
  | { type: 'invalid'; text: string }
  | { type: 'edit' }
  | { type: 'next'; step: NextStep }
  | { type: 'end'; role: 'customer' | 'provider' }
  | { type: 'myBusiness' }

/**
 * What the Done button does, without waiting for the server: the local check, then the unsaved fields are sent (never awaited)
 * and the outcome comes from held data. `wasOpen`: something was open when the screen was shown (false = a plain edit of a
 * finished profile). A customer has nothing after the account, so no held data is needed. `onSent` runs once the send settled.
 */
export function runDone(d: {
  isProvider: boolean
  wasOpen: boolean
  missing: () => Key[]
  invalid?: () => string | null
  flush: () => unknown
  next: () => NextStep | null | 'unknown'
  onSent?: () => void
}): DoneOutcome {
  const fields = d.missing()
  if (fields.length) return { type: 'missing', fields }
  const text = d.invalid?.()
  if (text) return { type: 'invalid', text }
  let sent: Promise<unknown>
  try {
    sent = Promise.resolve(d.flush())
  } catch {
    sent = Promise.resolve()
  }
  sent.catch(() => {}).finally(() => d.onSent?.())
  const step = d.isProvider ? d.next() : null
  if (step === 'unknown') return { type: 'myBusiness' }
  if (step) return { type: 'next', step }
  return d.wasOpen ? { type: 'end', role: d.isProvider ? 'provider' : 'customer' } : { type: 'edit' }
}

/**
 * One press of Done on the screen of `step`: the outcome, and the screen it opens (in the same tick). Payouts are never
 * started from Done (Stripe would hold the screen): My business opens, where the checklist and the payout card show it.
 * After the send the held data is refreshed in the background.
 */
export function pressDone(c: { isProvider: boolean; step: Step; missing: () => Key[]; invalid?: () => string | null; flush: () => unknown }, wasOpen: boolean): DoneOutcome {
  let sent = () => {}
  const out = runDone({ ...c, wasOpen, next: () => nextStepHeld(c.step), onSent: () => (sent(), void loadNextStep().catch(() => {})) })
  if (out.type === 'missing' || out.type === 'invalid') return out
  sent = flowCache.trust(c.step)
  if (out.type === 'edit') goBack()
  else if (out.type === 'myBusiness') goReplace('/my-profile')
  else if (out.type === 'next') goReplace(out.step.kind === 'payout' ? '/my-profile' : out.step.path)
  else finishFlow(out.role, out.role === 'provider' && payoutNotReady())
  return out
}

/** Ignores presses after one that moved on (`fn` returned true) until `reset` (the screen is shown again): a double tap never goes back twice. */
export function pressGuard(fn: () => boolean) {
  let moved = false
  return {
    press: () => void (moved ||= fn()),
    reset: () => void (moved = false),
  }
}
