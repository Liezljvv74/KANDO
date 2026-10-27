import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Alert, StyleSheet, Switch, Text, View } from 'react-native'

import { ApiError } from '@/api/client'
import { documentsApi, getMyProfile, photosApi, publishProfile, referencesApi, servicesApi, unpublishProfile } from '@/api/my-profile'
import { Button, ErrorText, Info } from '@/components/auth-ui'
import { Card, EditButton, formStyles, FormScreen, IconButton, SectionHeader } from '@/components/form-ui'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useLoad } from '@/hooks/use-load'
import { useCategories } from '@/hooks/use-categories'
import { docText, errorText, missingText, t, useLang } from '@/i18n'
import { documentRows, serviceDocNote } from '@/lib/documents'
import { formatPrice } from '@/lib/format'

import { DocumentsCard } from './documents-card'
import { ProfilePhoto } from './photo-card'
import { PortfolioCard } from './portfolio-card'

export const MAX_REFERENCES = 2 // mirrors MAX_PROVIDER_REFERENCES on the server

async function loadAll() {
  const profile = await getMyProfile()
  if (!profile) return { profile: null, services: [], references: [], photos: [], verifications: [] }
  const [services, references, photos, verifications] = await Promise.all([servicesApi.list(), referencesApi.list(), photosApi.list(), documentsApi.list()])
  return { profile, services, references, photos, verifications }
}

export default function MyProfileScreen() {
  useLang()
  const router = useRouter()
  const { done, data, error, retry } = useLoad(loadAll)
  const { categories, error: categoriesError, retry: retryCategories } = useCategories()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [missing, setMissing] = useState<string[]>([])

  const title = t('tab.myProfile')
  if (!done || !data) return <FormScreen title={title} back={false}>{error ? <ErrorRetry code={error} onRetry={retry} /> : <Loading />}</FormScreen>
  const { profile, services, references, photos, verifications } = data

  if (!profile) {
    return (
      <FormScreen title={t('myProfile.becomeTitle')} back={false}>
        <Card>
          <Info text={t('myProfile.becomeBody')} />
          <Button label={t('myProfile.becomeStart')} onPress={() => router.push('/my-profile/edit')} />
        </Card>
      </FormScreen>
    )
  }

  async function toggle() {
    setBusy(true)
    setProblem(null)
    setMissing([])
    try {
      await (profile!.status === 'published' ? unpublishProfile() : publishProfile())
      retry()
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'network'
      if (e instanceof ApiError && code === 'Profile incomplete') setMissing(e.missing ?? [])
      setProblem(errorText(code))
    }
    setBusy(false)
  }

  // Switching off asks first, so a stray tap cannot take the profile offline.
  const onLive = (on: boolean) =>
    on
      ? toggle()
      : Alert.alert(t('myProfile.unpublishAsk'), undefined, [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('myProfile.unpublish'), style: 'destructive', onPress: toggle },
        ])

  const published = profile.status === 'published'
  const name = profile.publicName ?? ''
  const docRows = documentRows(services, categories ?? [], verifications)
  return (
    <FormScreen title={title} back={false}>
      <Card>
        {/* Photo | headline and status | pencil above the Live switch. */}
        <View style={styles.row}>
          <ProfilePhoto photo={photos.find((p) => p.kind === 'profile') ?? null} name={name} onChanged={retry} />
          <View style={styles.rowText}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.status}>{published ? t('myProfile.published') : t('myProfile.draft')}</Text>
          </View>
          <View style={styles.side}>
            <EditButton label={t('myProfile.editProfile')} onPress={() => router.push('/my-profile/edit')} />
            <View style={styles.live}>
              <Text style={styles.liveLabel}>{t('myProfile.live')}</Text>
              <Switch value={published} onValueChange={onLive} disabled={busy} accessibilityLabel={t('myProfile.live')} trackColor={{ true: '#0E8A6B' }} />
            </View>
          </View>
        </View>
        {profile.suspendedUntil && new Date(profile.suspendedUntil) > new Date() ? <ErrorText text={errorText('Profile suspended')} /> : null}
        <ErrorText text={problem} />
        {published && services.length > 0 && !services.some((s) => s.visibleInSearch) && <Info text={t('myProfile.notInSearch')} />}
        {missing.length > 0 && (
          <View accessibilityRole="alert">
            <Text style={formStyles.label}>{t('myProfile.missingTitle')}</Text>
            {missing.map((m) => (
              <Text key={m} style={styles.item}>
                {'•'} {missingText(m)}
              </Text>
            ))}
          </View>
        )}
      </Card>

      <Card>
        <SectionHeader title={t('myProfile.services')}>
          <IconButton icon="add-circle-outline" label={t('myProfile.addService')} onPress={() => router.push('/my-profile/service/new')} />
        </SectionHeader>
        {services.length === 0 && <Info text={t('myProfile.noServices')} />}
        {services.map((s) => (
          <View key={s.id} style={styles.service}>
            <View style={styles.row}>
              <Text style={[styles.name, styles.rowText]}>{s.title}</Text>
              <EditButton label={`${t('common.edit')}: ${s.title}`} onPress={() => router.push({ pathname: '/my-profile/service/[id]', params: { id: String(s.id) } })} />
            </View>
            <Text style={styles.status}>
              {[categories?.find((c) => c.id === s.category)?.name, s.priceType && formatPrice({ ...s, priceType: s.priceType })].filter(Boolean).join(' · ')}
            </Text>
            {/* Only a reason of the service itself; a draft or suspended profile is shown on the profile card. */}
            {(s.categoryInactive || (s.waitingFor ?? []).length > 0) && (
              <Text style={styles.waiting}>
                {s.categoryInactive ? t('myProfile.categoryInactive') : t(serviceDocNote(s.waitingFor ?? [], docRows) === 'needed' ? 'myProfile.neededDocs' : 'myProfile.waitingDocs') + (s.waitingFor ?? []).map(docText).join(', ') + t('myProfile.docsHint')}
              </Text>
            )}
          </View>
        ))}
      </Card>

      <PortfolioCard photos={photos.filter((p) => p.kind === 'portfolio')} name={name} onChanged={retry} />
      {categoriesError && !categories && services.length > 0 ? (
        <Card>
          <ErrorRetry code={categoriesError} onRetry={retryCategories} />
        </Card>
      ) : (
        docRows.length > 0 && <DocumentsCard rows={docRows} onChanged={retry} />
      )}

      <Card>
        <SectionHeader title={t('provider.references')}>
          {references.length < MAX_REFERENCES && (
            <IconButton icon="add-circle-outline" label={t('myProfile.addReference')} onPress={() => router.push('/my-profile/reference/new')} />
          )}
        </SectionHeader>
        {references.length === 0 && <Info text={t('myProfile.noReferences')} />}
        {references.map((r) => (
          <View key={r.id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.name}>{r.clientName}</Text>
              {r.year ? <Text style={styles.status}>{r.year}</Text> : null}
            </View>
            <EditButton label={`${t('common.edit')}: ${r.clientName}`} onPress={() => router.push({ pathname: '/my-profile/reference/[id]', params: { id: String(r.id) } })} />
          </View>
        ))}
        {references.length >= MAX_REFERENCES && <Info text={t('error.referenceLimit')} />}
      </Card>
    </FormScreen>
  )
}

const styles = StyleSheet.create({
  name: { fontSize: 17, fontWeight: '700', color: '#14352E' },
  status: { fontSize: 14, color: '#5C7A72' },
  waiting: { fontSize: 13, color: '#9A6700', marginTop: 2 },
  item: { fontSize: 15, color: '#B3261E', marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  service: { gap: 2 },
  side: { alignItems: 'flex-end' },
  live: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveLabel: { fontSize: 13, fontWeight: '600', color: '#14352E' },
  rowText: { flex: 1 },
})
