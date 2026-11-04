import { useEffect, useState } from 'react'
import { Alert, StyleSheet, Text } from 'react-native'

import type { MyProfile, OwnService } from '@kando/contract'

import { ApiError } from '@/api/client'
import { publishProfile, unpublishProfile } from '@/api/my-profile'
import { ErrorText } from '@/components/auth-ui'
import { Card, SmallButton, SwitchRow } from '@/components/form-ui'
import { useCategories } from '@/hooks/use-categories'
import { canShare } from '@/lib/documents'
import { errorText, getLang, t } from '@/i18n'
import { isLive } from '@/lib/profile-form'
import { providerUrl, shareProfile } from '@/lib/share-profile'

/**
 * The Live switch at the top of the page: on publishes, off takes the profile offline (after a question), driven by the server's
 * `missing` list of the latest profile response. `onChanged` reloads the profile afterwards.
 */
export function PublishBar({ profile, services, onChanged }: { profile: MyProfile; services: OwnService[]; onChanged: () => void }) {
  const { categories } = useCategories()
  const [busy, setBusy] = useState(false)
  // Set when a publish succeeded here: the live message (with Share) shows until the page is left.
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

  const live = profile.status === 'published'
  const change = (on: boolean) => {
    if (on) return void run(publishProfile, true)
    Alert.alert(t('myProfile.unpublishAsk'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('setup.takeOffline'), style: 'destructive', onPress: () => run(unpublishProfile) },
    ])
  }

  const waitingServices = services.filter((s) => (s.waitingFor ?? []).length > 0)
  const waiting = waitingServices.length
  // Switched off and greyed out while the profile is incomplete; the starred fields say what is needed.
  const locked = !live && profile.missing.length > 0 && !refused
  return (
    <Card>
      <SwitchRow label={t('setup.live')} value={live} onChange={change} disabled={busy || locked} />
      {live && !isLive(profile) ? <ErrorText text={errorText('Profile suspended')} /> : null}
      {live && isLive(profile) && waiting > 0 ? <Text style={styles.live}>{t('setup.liveWaiting', { count: waiting })}</Text> : null}
      {justPublished && live && isLive(profile) && (
        <>
          <Text style={styles.live}>{waiting > 0 ? t('setup.pendingMessage', { category: categories?.find((c) => c.id === waitingServices[0]!.category)?.name ?? waitingServices[0]!.title }) : t('setup.liveMessage')}</Text>
          {canShare(services) && profile.slug ? <SmallButton label={t('setup.share')} onPress={() => shareProfile(providerUrl(profile.slug!, getLang()), getLang())} /> : null}
        </>
      )}
      <ErrorText text={problem} />
    </Card>
  )
}

const styles = StyleSheet.create({
  live: { fontSize: 16, fontWeight: '700', color: '#34328A' },
})
