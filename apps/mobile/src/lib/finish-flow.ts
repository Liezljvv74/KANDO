import { Alert } from 'react-native'

import { t } from '@/i18n'

import { goReplace } from './go'

/** The last step of the Done flow: a customer goes on to search; a provider is asked whether to change anything, else is taken on to publish.
 * `payoutNotReady`: the payout form was opened but Stripe has no bank details yet: the provider is told so, never "Everything is done". */
export function finishFlow(role: 'customer' | 'provider', payoutNotReady = false): void {
  if (role === 'customer') {
    Alert.alert(t('flow.allDone'), t('flow.customerDone'))
    goReplace('/search')
    return
  }
  const publish = () => {
    Alert.alert(t('flow.toPublish'))
    goReplace('/my-profile', { publish: String(Date.now()) }) // a new value each time, so the highlight runs again
  }
  if (payoutNotReady) {
    Alert.alert(t('flow.almostDone'), t('flow.payoutNotReady'), [
      { text: t('flow.finishPayouts'), onPress: () => goReplace('/my-profile') },
      { text: t('flow.continueToPublish'), onPress: publish },
    ])
    return
  }
  Alert.alert(t('flow.allDone'), t('flow.question'), [
    { text: t('flow.yesChange'), onPress: () => goReplace('/my-profile') },
    { text: t('flow.noContinue'), onPress: publish },
  ])
}
