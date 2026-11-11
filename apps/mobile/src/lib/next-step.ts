import type { MyProfile } from '@kando/contract'

import type { DocumentRow } from './documents'
import { checklistItems, openItems } from './live-checklist'

export type NextStep = { kind: 'account' | 'about' | 'service' | 'document'; path: string } | { kind: 'payout' }

type Input = {
  isProvider: boolean
  accountComplete: boolean
  profile: Pick<MyProfile, 'missing' | 'quoteSteps'> | null
  docRows: DocumentRow[]
}

/** Every required step still open, in the order the person should do them: account, About you, service, required documents, payouts. */
export function openSteps({ isProvider, accountComplete, profile, docRows }: Input): NextStep[] {
  const steps: NextStep[] = accountComplete ? [] : [{ kind: 'account', path: '/account' }]
  if (!isProvider || !profile) return steps
  const open = openItems(checklistItems({ missing: profile.missing, underCheck: [] }))
  for (const r of open) if (r.path.startsWith('/my-profile/about')) steps.push({ kind: 'about', path: r.path })
  for (const r of open) if (r.path === '/my-profile/service/new') steps.push({ kind: 'service', path: r.path })
  // A required document never sent, or one we rejected, is open; pending and approved are not.
  for (const d of docRows) if (!d.optional && (d.state === 'none' || d.state === 'rejected')) steps.push({ kind: 'document', path: `/my-profile/document/${d.requirement}` })
  if (profile.quoteSteps?.includes('payout')) steps.push({ kind: 'payout' })
  return steps
}

export const nextStep = (i: Input): NextStep | null => openSteps(i)[0] ?? null
