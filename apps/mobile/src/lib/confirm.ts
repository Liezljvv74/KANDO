import { Alert } from 'react-native'

import { t } from '@/i18n'

/** Asks before a step that cannot be undone; resolves true only when the person taps the destructive button. */
export const confirmDanger = (title: string, confirmLabel: string): Promise<boolean> =>
  new Promise((resolve) =>
    Alert.alert(
      title,
      undefined,
      [
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  )
