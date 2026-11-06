import * as WebBrowser from 'expo-web-browser'

import type { MyProfile } from '@kando/contract'

import { saveMyProfile } from '@/api/my-profile'
import { startPayoutSetup } from '@/api/payments'
import { go } from '@/lib/go'
import { isHttps } from '@/lib/safe-url'

/** Runs one missing step with the existing flows: payout opens Stripe (as the payout card does), consent is one save, the tax number field is in the payout card on the profile tab. The caller reloads the profile afterwards. */
export async function doQuoteStep(step: NonNullable<MyProfile['quoteSteps']>[number]) {
  if (step === 'consent') {
    await saveMyProfile({ invoiceConsent: true })
  } else if (step === 'payout') {
    const { url } = await startPayoutSetup()
    if (!isHttps(url)) throw new Error('bad link')
    await WebBrowser.openBrowserAsync(url)
  } else go('/my-profile')
}
