import { Alert } from 'react-native'

import { t } from '@/i18n'

/** Asks before a step that cannot be undone; resolves true only when the person taps the confirm button (red unless `destructive` is false, e.g. accepting a quote). */
export const confirmDanger = (title: string, confirmLabel: string, destructive = true): Promise<boolean> =>
  new Promise((resolve) =>
    Alert.alert(
      title,
      undefined,
      [
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  )
