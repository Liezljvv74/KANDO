import * as SecureStore from 'expo-secure-store'
import { useEffect, useState } from 'react'
import { StyleSheet, Text } from 'react-native'

import type { Me } from '@kando/contract'

import { Card } from '@/components/form-ui'
import { t } from '@/i18n'
import { pictureNudgeKey } from '@/lib/picture-nudge'
import { color } from '@/theme'

/** Shown while the person has no picture and has not dismissed it; the picture is added with the pencil next to it (no second button: owner decision, 13 November 2026). */
export function PictureNudge({ me }: { me: Me | null }) {
  const [dismissed, setDismissed] = useState(true)
  const key = me ? pictureNudgeKey(me.id) : ''
  useEffect(() => {
    if (key) SecureStore.getItemAsync(key).then((v) => setDismissed(!!v), () => {})
  }, [key])
  if (!me || me.photoUrl || dismissed) return null
  const dismiss = () => {
    setDismissed(true)
    SecureStore.setItemAsync(key, '1').catch(() => {})
  }
  return (
    <Card>
      <Text style={styles.body}>{t('home.pictureNudge')}</Text>
      <Text style={styles.dismiss} accessibilityRole="button" accessibilityLabel={t('home.pictureDismiss')} onPress={dismiss}>
        {'×'}
      </Text>
    </Card>
  )
}

const styles = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 22, color: color.ink, paddingRight: 32 },
  dismiss: { position: 'absolute', top: 0, right: 0, padding: 12, fontSize: 28, lineHeight: 32, color: color.ink },
})
