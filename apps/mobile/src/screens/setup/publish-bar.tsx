import { useEffect, useState } from 'react'
import { Alert, StyleSheet, Text } from 'react-native'

import type { MyProfile, OwnService } from '@kando/contract'

import { ApiError } from '@/api/client'
import { publishProfile, unpublishProfile } from '@/api/my-profile'
import { Button, ErrorText } from '@/components/auth-ui'
import { Card, SmallButton } from '@/components/form-ui'
import { useCategories } from '@/hooks/use-categories'
import { canShare } from '@/lib/documents'
import { errorText, getLang, t } from '@/i18n'
import { isLive } from '@/lib/profile-form'
import { providerUrl, shareProfile } from '@/lib/share-profile'

/**
 * Publish / Live, driven by the server's `missing` list of the latest profile response.
 * `onChanged` reloads the profile after a publish or unpublish.
 */
export function PublishBar({ profile, services, onChanged }: { profile: MyProfile; services: OwnService[]; onChanged: () => void }) {
  const { categories } = useCategories()
  const [busy, setBusy] = useState(false)
  // Set when a Publish succeeded here: the live message (with Share) shows until the page is left.
  const [justPublished, setJustPublished] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // Set when the server answered 409 'Profile incomplete'; the next profile response clears it.
  const [refused, setRefused] = useState(false)
  useEffect(() => setRefused(false), [profile])

  async function run(action: () => Promise<unknown>, published = false) {
    setBusy(true)
    setProblem(null)
    try {
      await action()
      setJustPublished(published)
      onChanged()
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'network'
      setProblem(errorText(code))
      setRefused(code === 'Profile incomplete')
    }
    setBusy(false)
  }

  const takeOffline = () =>
    Alert.alert(t('myProfile.unpublishAsk'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('setup.takeOffline'), style: 'destructive', onPress: () => run(unpublishProfile) },
    ])

  if (profile.status === 'published') {
    const waitingServices = services.filter((s) => (s.waitingFor ?? []).length > 0)
    const waiting = waitingServices.length
    return (
      <Card>
        {isLive(profile) ? <Text style={styles.live}>{waiting > 0 ? t('setup.liveWaiting', { count: waiting }) : t('setup.live')}</Text> : <ErrorText text={errorText('Profile suspended')} />}
        {justPublished && isLive(profile) && (
          <>
            <Text style={styles.live}>{waiting > 0 ? t('setup.pendingMessage', { category: categories?.find((c) => c.id === waitingServices[0]!.category)?.name ?? waitingServices[0]!.title }) : t('setup.liveMessage')}</Text>
            {canShare(services) && profile.slug ? <SmallButton label={t('setup.share')} onPress={() => shareProfile(providerUrl(profile.slug!, getLang()), getLang())} /> : null}
          </>
        )}
        <SmallButton label={t('setup.takeOffline')} onPress={takeOffline} busy={busy} />
        <ErrorText text={problem} />
      </Card>
    )
  }

  // Nothing is shown while the profile is incomplete: the fields say what they need.
  if (profile.missing.length && !refused) return null
  return (
    <Card>
      <Button label={t('setup.publish')} onPress={() => run(publishProfile, true)} busy={busy} />
      <ErrorText text={problem} />
    </Card>
  )
}

const styles = StyleSheet.create({
  live: { fontSize: 16, fontWeight: '700', color: '#0E8A6B' },
})
