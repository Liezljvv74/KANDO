import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import type { MyProfile } from '@kando/contract'

import { documentsApi, ensureDraft, getMyProfile, photosApi, referencesApi, servicesApi } from '@/api/my-profile'
import { ErrorText, Info } from '@/components/auth-ui'
import { Card, FormScreen, SectionHeader } from '@/components/form-ui'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useCategories } from '@/hooks/use-categories'
import { useLoad } from '@/hooks/use-load'
import { errorText, t, useLang } from '@/i18n'
import { documentRows } from '@/lib/documents'
import { formatPrice } from '@/lib/format'
import { DocumentsCard } from '../my-profile/documents-card'
import { PortfolioCard } from '../my-profile/portfolio-card'
import { ProfilePhoto } from '../my-profile/photo-card'
import { AboutCard } from './about-card'
import { PublishBar } from './publish-bar'
import { ReferencesCard } from './references-card'

async function loadAll() {
  const profile = (await getMyProfile()) ?? (await ensureDraft())
  const [services, references, photos, verifications] = await Promise.all([servicesApi.list(), referencesApi.list(), photosApi.list(), documentsApi.list()])
  return { profile, services, references, photos, verifications }
}

/** The one-page "My service profile". */
export default function SetupScreen() {
  useLang()
  const params = useLocalSearchParams<{ welcome?: string }>()
  // The sign-up lands here with ?welcome=1: the welcome title shows until the user leaves the tab.
  const [welcome, setWelcome] = useState(params.welcome === '1')
  useEffect(() => {
    if (params.welcome === '1') setWelcome(true)
  }, [params.welcome])
  useFocusEffect(useCallback(() => () => setWelcome(false), []))

  const { done, data, error, retry } = useLoad(loadAll)
  const { categories } = useCategories()
  // The latest profile the server sent: a load or any field save replaces it (the Publish bar reads its `missing`).
  const [profile, setProfile] = useState<MyProfile | null>(null)
  useEffect(() => {
    if (data) setProfile(data.profile)
  }, [data])

  const title = welcome ? t('setup.welcome') : t('setup.title')
  if (!done || !data || !profile) return <FormScreen title={title} back={false}>{error ? <ErrorRetry code={error} onRetry={retry} /> : <Loading />}</FormScreen>
  const { services, references, photos, verifications } = data
  const name = profile.publicName ?? ''
  const docRows = documentRows(services, categories ?? [], verifications)

  return (
    <FormScreen title={title} back={false}>
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

      <PublishBar profile={profile} services={services} onChanged={retry} />

      <AboutCard initial={data.profile} onSaved={setProfile} />

      {/* Task 8 replaces this read-only list with the Services card. */}
      <Card>
        <SectionHeader title={t('myProfile.services')} />
        {services.length === 0 && <Info text={t('myProfile.noServices')} />}
        {services.map((s) => (
          <View key={s.id}>
            <Text style={styles.name}>{s.title}</Text>
            <Text style={styles.status}>{s.priceType ? formatPrice({ ...s, priceType: s.priceType }) : ''}</Text>
          </View>
        ))}
      </Card>

      <ReferencesCard references={references} />
      <PortfolioCard photos={photos.filter((p) => p.kind === 'portfolio')} name={name} onChanged={retry} />
      {docRows.length > 0 && <DocumentsCard rows={docRows} onChanged={retry} />}
    </FormScreen>
  )
}

const styles = StyleSheet.create({
  name: { fontSize: 17, fontWeight: '700', color: '#14352E' },
  status: { fontSize: 14, color: '#5C7A72' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1 },
})
