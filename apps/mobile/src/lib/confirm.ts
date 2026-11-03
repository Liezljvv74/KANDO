import { Alert } from 'react-native'

import { t } from '@/i18n'

const ask = (title: string, confirmLabel: string, style: 'default' | 'destructive'): Promise<boolean> =>
  new Promise((resolve) =>
    Alert.alert(
      title,
      undefined,
      [
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  )

/** Asks before a step that cannot be undone; resolves true only when the person taps the (red) confirm button. */
export const confirmDanger = (title: string, confirmLabel: string): Promise<boolean> => ask(title, confirmLabel, 'destructive')

/** Asks before a step that is fine but should be read first (e.g. accepting a quote); the confirm button is not red. */
export const confirmAction = (title: string, confirmLabel: string): Promise<boolean> => ask(title, confirmLabel, 'default')
