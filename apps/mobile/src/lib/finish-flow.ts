import { Alert } from 'react-native'

import { t } from '@/i18n'

import { goReplace } from './go'

/** The last step of the Done flow: a customer goes on to search; a provider is asked whether to change anything, else is taken on to publish. */
export function finishFlow(role: 'customer' | 'provider'): void {
  if (role === 'customer') {
    Alert.alert(t('flow.allDone'), t('flow.customerDone'))
    goReplace('/search')
    return
  }
  Alert.alert(t('flow.allDone'), t('flow.question'), [
    { text: t('flow.yesChange'), onPress: () => goReplace('/my-profile') },
    {
      text: t('flow.noContinue'),
      onPress: () => {
        Alert.alert(t('flow.toPublish'))
        goReplace('/my-profile', { publish: String(Date.now()) }) // a new value each time, so the highlight runs again
      },
    },
  ])
}
