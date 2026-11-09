import * as SecureStore from 'expo-secure-store'
import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text } from 'react-native'

import { photosApi } from '@/api/my-profile'
import { Button, ErrorText } from '@/components/auth-ui'
import { Card } from '@/components/form-ui'
import { loadMe } from '@/hooks/use-me'
import { errorText, t } from '@/i18n'
import { askPhotoSource } from '@/lib/ask-photo-source'
import { pictureNudgeKey } from '@/lib/picture-nudge'
import { pickPhoto, uploadErrorCode } from '@/lib/pick'
import { color } from '@/theme'

/** Shown while the person has no picture and has not dismissed it; the account picture serves customers and providers alike. */
export function PictureNudge() {
  const [show, setShow] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [key, setKey] = useState('')
  useEffect(() => {
    loadMe()
      .then(async (me) => {
        setKey(pictureNudgeKey(me.id))
        setShow(!me.photoUrl && !(await SecureStore.getItemAsync(pictureNudgeKey(me.id))))
      })
      .catch(() => {})
  }, [])
  const dismiss = () => {
    setShow(false)
    SecureStore.setItemAsync(key, '1').catch(() => {})
  }
  const add = useCallback(async (source: 'camera' | 'library') => {
    setProblem(null)
    try {
      const file = await pickPhoto(source, true)
      if (file === 'denied') setProblem(t('myProfile.denied'))
      else if (file) {
        await photosApi.add(file, 'profile')
        setShow(false)
      }
    } catch (e) {
      setProblem(errorText(uploadErrorCode(e)))
    }
  }, [])
  if (!show) return null
  return (
    <Card>
      <Text style={styles.body}>{t('home.pictureNudge')}</Text>
      <ErrorText text={problem} />
      <Button label={t('home.pictureAdd')} onPress={() => askPhotoSource(add)} />
      <Text style={styles.dismiss} accessibilityRole="button" accessibilityLabel={t('home.pictureDismiss')} onPress={dismiss}>
        {'×'}
      </Text>
    </Card>
  )
}

const styles = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 22, color: color.ink },
  dismiss: { position: 'absolute', top: 0, right: 0, padding: 12, fontSize: 28, lineHeight: 32, color: color.ink },
})
