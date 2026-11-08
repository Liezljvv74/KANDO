import * as WebBrowser from 'expo-web-browser'

import type { MyProfile } from '@kando/contract'

import { saveMyProfile } from '@/api/my-profile'
import { payoutStatus, startPayoutSetup } from '@/api/payments'
import { loadMe, noteQuoteSteps } from '@/hooks/use-me'
import { go } from '@/lib/go'
import { isHttps } from '@/lib/safe-url'

let opened = false
/** Whether this person opened the Stripe page in this app session (from the payout card or a checklist row): the payout card then says "waiting". */
export const payoutOpened = () => opened

/**
 * The one Stripe round trip: opens the set-up page, then on return asks the payout status once (so `payouts_ready_at` is fresh
 * even when Stripe's webhook never arrives) and, only when it is ready, reloads `/me` once so every checklist drops the step.
 * Returns the status (null when it could not be read).
 */
export async function openPayoutSetup() {
  const { url } = await startPayoutSetup()
  if (!isHttps(url)) throw new Error('bad link')
  opened = true
  await WebBrowser.openBrowserAsync(url)
  const status = await payoutStatus().catch(() => null)
  if (status?.ready) await loadMe().catch(() => {})
  return status
}

/** Saves invoicing fields (consent, tax number); the profile in the answer carries the fresh quote steps, so the shared `/me` is updated without another request. */
export async function saveQuoteField(body: object) {
  const p = await saveMyProfile(body)
  noteQuoteSteps(p.quoteSteps)
  return p
}

/** Runs one missing step with the existing flows: payout opens Stripe, consent is one save (its saved profile is returned), the tax number opens its field (`onTaxId`, on My business) or My business. */
export async function doQuoteStep(step: NonNullable<MyProfile['quoteSteps']>[number], onTaxId?: () => void): Promise<MyProfile | undefined> {
  if (step === 'consent') return saveQuoteField({ invoiceConsent: true })
  if (step === 'payout') await openPayoutSetup()
  else if (onTaxId) onTaxId()
  else go('/my-profile')
}
