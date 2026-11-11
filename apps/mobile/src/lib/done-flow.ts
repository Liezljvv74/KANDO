import type { Key } from '@/i18n'

import type { NextStep } from './next-step'

export type DoneOutcome = { type: 'missing'; fields: Key[] } | { type: 'failed' } | { type: 'edit' } | { type: 'next'; step: NextStep } | { type: 'end'; role: 'customer' | 'provider' }

/**
 * What the Done button does. "edit" means nothing was open before the press (a plain edit of a finished profile);
 * if something was open and now nothing is, the flow has ended. A failed look at what is open before the save counts as open.
 */
export async function runDone(d: { isProvider: boolean; missing: () => Key[]; commit: () => Promise<boolean>; loadNext: () => Promise<NextStep | null> }): Promise<DoneOutcome> {
  const fields = d.missing()
  if (fields.length) return { type: 'missing', fields }
  const wasOpen = await d.loadNext().then((s) => s !== null, () => true)
  if (!(await d.commit())) return { type: 'failed' }
  let step: NextStep | null
  try {
    step = await d.loadNext()
  } catch {
    return { type: 'edit' }
  }
  if (step) return { type: 'next', step }
  return wasOpen ? { type: 'end', role: d.isProvider ? 'provider' : 'customer' } : { type: 'edit' }
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
