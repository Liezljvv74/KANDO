import { Linking } from 'react-native'

import { ErrorText } from '@/components/auth-ui'
import { Actions, SmallButton } from '@/components/form-ui'
import { t } from '@/i18n'

/** Shown after a refused camera/photo permission: iOS never asks twice, so the way back is the Settings app. */
export const DeniedNotice = () => (
  <>
    <ErrorText text={t('myProfile.denied')} />
    <Actions>
      <SmallButton label={t('myProfile.openSettings')} onPress={() => Linking.openSettings()} />
    </Actions>
  </>
)
