import { documentsApi, getMyProfile, servicesApi } from '@/api/my-profile'
import { getCategories } from '@/api/providers'
import { loadMe } from '@/hooks/use-me'
import { getLang } from '@/i18n'

import { openPayoutSetup, payoutOpened } from './do-quote-step'
import { documentRows } from './documents'
import { finishFlow } from './finish-flow'
import { goReplace } from './go'
import { nextStep, type NextStep } from './next-step'

/** The next open step, from fresh server data (never cached). A customer's account is the only thing that can be open for them. */
export async function loadNextStep(): Promise<NextStep | null> {
  const me = await loadMe()
  const isProvider = me.isProvider === true
  // same rule as the account screen: name and postcode, a provider's date of birth too
  const accountComplete = !!me.firstName?.trim() && !!me.lastName?.trim() && !!me.address?.postcode && (!isProvider || !!me.birthDate)
  if (!isProvider) return accountComplete ? null : nextStep({ isProvider, accountComplete, profile: null, docRows: [] })
  const [profile, services, verifications, categories] = await Promise.all([getMyProfile(), servicesApi.list(), documentsApi.list(), getCategories(getLang())])
  return nextStep({ isProvider, accountComplete, profile, docRows: documentRows(services, categories, verifications), payoutSent: profile?.payoutStarted === true || payoutOpened() }) // the server's flag lasts; the local marker covers a form just opened and an older server
}

/** Opens the screen of a step; replace, so back does not return to the finished screen. `followUp`: after a ready payout, one more step may follow, never a second payout (no loop). */
export async function goToStep(step: NextStep, followUp = true, stillHere: () => boolean = () => true): Promise<void> {
  if (step.kind !== 'payout') return goReplace(step.path)
  const status = await openPayoutSetup().catch(() => null)
  if (!stillHere()) return // the screen was left during the Stripe round trip
  if (!status?.ready || !followUp) return goReplace('/my-profile')
  return continueAfterAutoStep(stillHere)
}

/** After a step finished by itself (`stillHere`: false once the screen was left, then nothing navigates) (a document uploaded, payouts ready): the next open step, the end of the flow, or My profile when it cannot be read. Never opens Stripe again (no loop). */
export async function continueAfterAutoStep(stillHere: () => boolean): Promise<void> {
  let next: NextStep | null
  try {
    next = await loadNextStep()
  } catch {
    if (stillHere()) goReplace('/my-profile')
    return
  }
  if (!stillHere()) return // the person left the screen while this loaded: nothing opens
  if (!next) return finishFlow('provider')
  if (next.kind === 'payout') return goReplace('/my-profile')
  return goToStep(next, false, stillHere)
}
