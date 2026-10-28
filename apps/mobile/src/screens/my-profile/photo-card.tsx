import { useState } from 'react'
import Ionicons from '@expo/vector-icons/Ionicons'
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native'

import type { Photo as OwnPhoto } from '@kando/contract'

import { photosApi } from '@/api/my-profile'
import { Avatar } from '@/components/avatar'
import { ErrorText } from '@/components/auth-ui'
import { errorText, t } from '@/i18n'
import { pickPhoto, uploadErrorCode } from '@/lib/pick'
import { DeniedNotice } from './denied-notice'

/** The profile photo with a pencil over its bottom-right edge; the pencil asks camera or library, and offers Remove when there is a picture. */
export function ProfilePhoto({ photo, name, onChanged }: { photo: OwnPhoto | null; name: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)

  async function pick(source: 'camera' | 'library') {
    setBusy(true)
    setProblem(null)
    setDenied(false)
    try {
      const file = await pickPhoto(source, true)
      if (file === 'denied') setDenied(true)
      else if (file) {
        await photosApi.add(file, 'profile')
        onChanged()
      }
    } catch (e) {
      setProblem(errorText(uploadErrorCode(e)))
    }
    setBusy(false)
  }

  async function remove(id: string) {
    setBusy(true)
    setProblem(null)
    setDenied(false)
    try {
      await photosApi.remove(id)
      onChanged()
    } catch (e) {
      setProblem(errorText(uploadErrorCode(e)))
    }
    setBusy(false)
  }

  const choose = () =>
    Alert.alert(t('missing.photo'), undefined, [
      { text: t('myProfile.photoTake'), onPress: () => pick('camera') },
      { text: t('myProfile.photoChoose'), onPress: () => pick('library') },
      ...(photo ? [{ text: t('myProfile.photoRemove'), style: 'destructive' as const, onPress: () => remove(photo.id) }] : []),
      { text: t('common.cancel'), style: 'cancel' as const },
    ])

  return (
    <View style={styles.root}>
      <View>
        <Avatar name={name} url={photo?.url ?? null} size={72} />
        <Pressable
          onPress={choose}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('myProfile.photoEdit')}
          accessibilityState={{ busy, disabled: busy }}
          style={styles.edit}
        >
          {busy ? <ActivityIndicator color="#0E8A6B" /> : <Ionicons name="pencil" size={20} color="#0E8A6B" style={styles.halo} />}
        </Pressable>
      </View>
      <ErrorText text={problem} />
      {denied && <DeniedNotice />}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  // Half over the photo's edge; no frame, a white halo keeps the pencil readable on any photo.
  // Just below the photo's centre line, on its right edge (photo 72, button 44: its centre sits at 46 of 72).
  edit: { position: 'absolute', right: -14, top: 24, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  halo: { textShadowColor: '#fff', textShadowRadius: 4, textShadowOffset: { width: 0, height: 0 } },
})
