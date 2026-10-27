import { useEffect, useState } from 'react'
import { Alert, StyleSheet, Text } from 'react-native'

import type { MyProfile, OwnService } from '@kando/contract'

import { ApiError } from '@/api/client'
import { publishProfile, unpublishProfile } from '@/api/my-profile'
import { Button, ErrorText } from '@/components/auth-ui'
import { Card, SmallButton } from '@/components/form-ui'
import { errorText, missingText, t } from '@/i18n'

/**
 * Publish / Live, driven by the server's `missing` list of the latest profile response.
 * `onChanged` reloads the profile after a publish or unpublish.
 */
export function PublishBar({ profile, services, onChanged }: { profile: MyProfile; services: OwnService[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // The list a 409 'Profile incomplete' came back with; the next profile response replaces it.
  const [refused, setRefused] = useState<string[] | null>(null)
  useEffect(() => setRefused(null), [profile])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setProblem(null)
    try {
      await action()
      onChanged()
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'network'
      if (e instanceof ApiError && code === 'Profile incomplete') setRefused(e.missing ?? [])
      else setProblem(errorText(code))
    }
    setBusy(false)
  }

  const takeOffline = () =>
    Alert.alert(t('myProfile.unpublishAsk'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('setup.takeOffline'), style: 'destructive', onPress: () => run(unpublishProfile) },
    ])

  if (profile.status === 'published') {
    const waiting = services.filter((s) => (s.waitingFor ?? []).length > 0).length
    return (
      <Card>
        <Text style={styles.live}>{waiting > 0 ? t('setup.liveWaiting', { count: waiting }) : t('setup.live')}</Text>
        <SmallButton label={t('setup.takeOffline')} onPress={takeOffline} busy={busy} />
        <ErrorText text={problem} />
      </Card>
    )
  }

  const missing = refused ?? profile.missing
  return (
    <Card>
      <Button
        label={missing.length ? t('setup.publishMissing', { items: missing.map(missingText).join(', ') }) : t('setup.publish')}
        onPress={() => run(publishProfile)}
        busy={busy}
        disabled={missing.length > 0}
      />
      <ErrorText text={problem} />
    </Card>
  )
}

const styles = StyleSheet.create({
  live: { fontSize: 16, fontWeight: '700', color: '#0E8A6B' },
})
