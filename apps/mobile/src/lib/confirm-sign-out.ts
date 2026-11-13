import { Alert } from 'react-native'

import { t } from '@/i18n'
import { dropAccount, listEntries } from '@/lib/pending-saves'

/** Unsaved changes are lost on sign-out, so ask first; they are dropped before the session ends. No account id: signs out without asking. */
export function confirmSignOut(accountId: string | undefined, signOut: () => unknown) {
  if (!accountId || listEntries(accountId).length === 0) return void signOut()
  Alert.alert(t('pending.signOutAsk'), undefined, [
    { text: t('pending.signOutStay'), style: 'cancel' },
    {
      text: t('pending.signOutYes'),
      style: 'destructive',
      onPress: () => {
        dropAccount(accountId)
        signOut()
      },
    },
  ])
}
