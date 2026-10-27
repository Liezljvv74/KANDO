import { Alert } from 'react-native'

import { t } from '@/i18n'

/** "Take photo / Choose photo / Cancel" for the person's picture. */
export const askPhotoSource = (pick: (source: 'camera' | 'library') => void) =>
  Alert.alert(t('missing.photo'), undefined, [
    { text: t('myProfile.photoTake'), onPress: () => pick('camera') },
    { text: t('myProfile.photoChoose'), onPress: () => pick('library') },
    { text: t('common.cancel'), style: 'cancel' },
  ])
