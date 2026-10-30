import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { documentsApi, ensureDraft, getMyProfile, photosApi, referencesApi, servicesApi } from '@/api/my-profile'
import { ErrorText, Info } from '@/components/auth-ui'
import { Card, FormScreen } from '@/components/form-ui'
import { NotificationBanners } from '@/components/notification-banner'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useCategories } from '@/hooks/use-categories'
import { useLoad } from '@/hooks/use-load'
import { loadMe, markNotificationsSeen, useMe } from '@/hooks/use-me'
import { errorText, t, useLang } from '@/i18n'
import { canShare, documentRows } from '@/lib/documents'
import { createStaleGuard } from '@/lib/stale-guard'
import { PortfolioCard } from '../my-profile/portfolio-card'
import { ProfilePhoto } from '../my-profile/photo-card'
import { AboutCard } from './about-card'
import { DocumentsCard } from './documents-card'
import { PayoutCard } from './payout-card'
import { PublishBar } from './publish-bar'
import { ReferencesCard } from './references-card'
import { ServicesCard } from './services-card'

/** The one-page "My service profile". */
export default function SetupScreen() {
  useLang()
  const params = useLocalSearchParams<{ welcome?: string }>()
  // The sign-up lands here with ?welcome=1: the welcome title shows until the user leaves the tab.
  const [welcome, setWelcome] = useState(params.welcome === '1')
  useEffect(() => {
    if (params.welcome === '1') setWelcome(true)
  }, [params.welcome])
  useFocusEffect(
    useCallback(
      () => () => {
        setWelcome(false)
      },
      [],
    ),
  )

  // Every load and every save stamps itself; an answer older than one already applied never replaces the held profile.
  const stamp = useRef(createStaleGuard()).current
  const loadAll = useCallback(async () => {
    const fresh = stamp()
    const profile = (await getMyProfile()) ?? (await ensureDraft())
    const [services, references, photos, verifications] = await Promise.all([servicesApi.list(), referencesApi.list(), photosApi.list(), documentsApi.list()])
    // Opening the page marks the notifications seen; a /me failure must not hold the page back.
    loadMe().then(markNotificationsSeen).catch(() => {})
    return { profile, services, references, photos, verifications, fresh }
  }, [stamp])
  const { done, data, error, retry } = useLoad(loadAll)
  const { categories } = useCategories()
  const me = useMe()
  const title = welcome ? t('setup.welcome') : t('setup.title')
  if (!done || !data) return <FormScreen title={title} back={false}>{error ? <ErrorRetry code={error} onRetry={retry} /> : <Loading />}</FormScreen>
  const { profile, services, references, photos, verifications } = data
  const name = profile.publicName ?? ''
  const docRows = documentRows(services, categories ?? [], verifications)

  return (
    <FormScreen title={title} back={false}>
      <NotificationBanners me={me} canShare={canShare(services)} />
      <Card>
        <View style={styles.row}>
          <ProfilePhoto photo={photos.find((p) => p.kind === 'profile') ?? null} name={name} onChanged={retry} />
          <View style={styles.rowText}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.status}>{profile.status === 'published' ? t('myProfile.published') : t('myProfile.draft')}</Text>
          </View>
        </View>
        {profile.suspendedUntil && new Date(profile.suspendedUntil) > new Date() ? <ErrorText text={errorText('Profile suspended')} /> : null}
      </Card>

      <PayoutCard />

      <PublishBar profile={profile} services={services} onChanged={retry} />

      <ServicesCard services={services} docRows={docRows} />

      <AboutCard profile={profile} />

      <ReferencesCard references={references} />
      <PortfolioCard photos={photos.filter((p) => p.kind === 'portfolio')} name={name} onChanged={retry} />
      {docRows.some((r) => r.optional) && <Info text={t('setup.documentsExtra')} />}
      {docRows.length > 0 && <DocumentsCard rows={docRows} />}
    </FormScreen>
  )
}

const styles = StyleSheet.create({
  name: { fontSize: 17, fontWeight: '700', color: '#14352E' },
  status: { fontSize: 14, color: '#5C7A72' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1 },
})
