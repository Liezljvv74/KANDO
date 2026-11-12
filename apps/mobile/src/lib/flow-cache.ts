import type { Me } from '@kando/contract'

import { signOutGeneration } from '@/hooks/use-me'

import type { DocumentRow } from './documents'
import { openSteps, type NextStep } from './next-step'

export type Step = NextStep['kind']
export type FlowData = {
  me: Pick<Me, 'isProvider' | 'firstName' | 'lastName' | 'address' | 'birthDate'>
  profile: Parameters<typeof openSteps>[0]['profile']
  docRows: DocumentRow[]
  payoutSent?: boolean
}

type Start = { generation: number; n: number }
let held: { data: FlowData; generation: number; n: number } | null = null
const trusted = new Map<Step, number>()
let seq = 0
let loads = 0

/** Every open step of this data, in order (the rules of `next-step`). Same account rule as the account screen: name and postcode, a provider's date of birth too. */
export function stepsOf({ me, profile, docRows, payoutSent }: FlowData): NextStep[] {
  const isProvider = me.isProvider === true
  const accountComplete = !!me.firstName?.trim() && !!me.lastName?.trim() && !!me.address?.postcode && (!isProvider || !!me.birthDate)
  return openSteps({ isProvider, accountComplete, profile: isProvider ? profile : null, docRows: isProvider ? docRows : [], payoutSent })
}

/** The newest server data for the Done flow, so Done picks the next step without a request. */
export const flowCache = {
  /** Taken when a load starts: its data is noted only if no later-started load was noted first (the newest request wins). */
  begin: (): Start => ({ generation: signOutGeneration(), n: ++loads }),
  /** A load that ran over a sign-out, or one older than the data held, is never used. */
  note(data: FlowData, start: Start = flowCache.begin()) {
    if (held && start.n < held.n) return
    if (held && held.generation !== start.generation) trusted.clear()
    held = { data, ...start }
  },
  /** A step whose Done passed the local check counts as finished until the returned function is called (its refresh landed). */
  trust(step: Step): () => void {
    const n = ++seq
    trusted.set(step, n)
    return () => void (trusted.get(step) === n && trusted.delete(step))
  },
  clear() {
    held = null
    trusted.clear()
  },
}

/** The next open step from held data, skipping `justFinished` and the steps trusted as finished; 'unknown' when nothing of this account is held. */
export function nextStepHeld(justFinished?: Step): NextStep | null | 'unknown' {
  if (!held || held.generation !== signOutGeneration()) return 'unknown'
  return stepsOf(held.data).find((s) => s.kind !== justFinished && !trusted.has(s.kind)) ?? null
}
