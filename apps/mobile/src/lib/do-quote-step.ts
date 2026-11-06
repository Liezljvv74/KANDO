import * as WebBrowser from 'expo-web-browser'

import type { MyProfile } from '@kando/contract'

import { getMyProfile, saveMyProfile } from '@/api/my-profile'
import { payoutStatus, startPayoutSetup } from '@/api/payments'
import { go } from '@/lib/go'
import { isHttps } from '@/lib/safe-url'

/** The profile; while the payout step is open the payout status is read first, so `payouts_ready_at` is fresh even when Stripe's webhook never arrives. */
export async function getProfileFresh() {
  const p = await getMyProfile()
  if (!p?.quoteSteps?.includes('payout')) return p
  const status = await payoutStatus().catch(() => null)
  return status?.ready ? getMyProfile() : p
}

/** Runs one missing step with the existing flows: payout opens Stripe (as the payout card does), consent is one save, the tax number opens its field (`onTaxId`, on My business) or the profile tab. The caller reloads the profile afterwards. */
export async function doQuoteStep(step: NonNullable<MyProfile['quoteSteps']>[number], onTaxId?: () => void) {
  if (step === 'consent') {
    await saveMyProfile({ invoiceConsent: true })
  } else if (step === 'payout') {
    const { url } = await startPayoutSetup()
    if (!isHttps(url)) throw new Error('bad link')
    await WebBrowser.openBrowserAsync(url)
    await payoutStatus().catch(() => {})
  } else if (onTaxId) onTaxId()
  else go('/my-profile')
}
