import type { Key } from '@/i18n'

import type { NextStep } from './next-step'

export type DoneOutcome = { type: 'missing'; fields: Key[] } | { type: 'failed' } | { type: 'edit' } | { type: 'next'; step: NextStep } | { type: 'end'; role: 'customer' | 'provider' }

/**
 * What the Done button does. `wasOpen` is the snapshot taken when the screen gained focus (fields auto-save, so the press itself
 * is too late to ask): false = a plain edit of a finished profile; true and nothing open now = the flow has ended.
 */
export async function runDone(d: { isProvider: boolean; wasOpen: boolean; missing: () => Key[]; commit: () => Promise<boolean>; loadNext: () => Promise<NextStep | null> }): Promise<DoneOutcome> {
  const fields = d.missing()
  if (fields.length) return { type: 'missing', fields }
  let ok = false
  try {
    ok = await d.commit()
  } catch {
    ok = false
  }
  if (!ok) return { type: 'failed' }
  let step: NextStep | null
  try {
    step = await d.loadNext()
  } catch {
    return d.wasOpen ? { type: 'failed' } : { type: 'edit' } // saved; in the flow the person stays and presses Done again, a plain edit simply ends
  }
  if (step) return { type: 'next', step }
  return d.wasOpen ? { type: 'end', role: d.isProvider ? 'provider' : 'customer' } : { type: 'edit' }
}

/** Ignores calls while the previous one has not finished (double-tap guard). */
export const createOnce = <A extends unknown[]>(fn: (...a: A) => Promise<unknown>) => {
  let busy = false
  return async (...a: A) => {
    if (busy) return
    busy = true
    try {
      await fn(...a)
    } finally {
      busy = false
    }
  }
}
