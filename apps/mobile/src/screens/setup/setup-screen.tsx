import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import type { KeyboardAwareScrollView } from 'react-native-keyboard-controller'

import type { MyProfile } from '@kando/contract'

import { documentsApi, ensureDraft, getMyProfile, photosApi, referencesApi, servicesApi } from '@/api/my-profile'
import { ErrorText, Info } from '@/components/auth-ui'
import { Card, FormScreen } from '@/components/form-ui'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useCategories } from '@/hooks/use-categories'
import { useLoad } from '@/hooks/use-load'
import { loadMe, markNotificationsSeen, useMe } from '@/hooks/use-me'
import { errorText, t, useLang } from '@/i18n'
import { categoryOf } from '@/lib/job-notices'
import { documentRows } from '@/lib/documents'
import { createSaveGuard, freshOr } from '@/lib/save-guard'
import { InvoicesCard } from '../invoices/invoices-card'
import { PortfolioCard } from '../my-profile/portfolio-card'
import { ProfilePhoto } from '../my-profile/photo-card'
import { AboutCard } from './about-card'
import { DocumentsCard } from './documents-card'
import { PayoutCard } from './payout-card'
import { PublishBar } from './publish-bar'
import { ReferencesCard } from './references-card'
import { ServicesCard } from './services-card'
import { color } from '@/theme'

/** The one-page "My business". */
export default function SetupScreen() {
  useLang()
  const params = useLocalSearchParams<{ welcome?: string; publish?: string }>()
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

  // A reload that started before a save (the app back in front, a retry) must not bring back the profile the save replaced.
  const saves = useRef(createSaveGuard<MyProfile>()).current
  const loadAll = useCallback(async () => {
    const fresh = saves.start()
    const loaded = (await getMyProfile()) ?? (await ensureDraft())
    const [services, references, photos, verifications] = await Promise.all([servicesApi.list(), referencesApi.list(), photosApi.list(), documentsApi.list()])
    // Opening the page marks the notifications seen; a /me failure must not hold the page back.
    loadMe().then(() => markNotificationsSeen((n) => !categoryOf(n))).catch(() => {})
    return { profile: freshOr(loaded, fresh(), saves.latest()), services, references, photos, verifications }
  }, [saves])
  const { done, data, error, retry, update } = useLoad(loadAll)
  // An invoicing save or a checklist step answers with the profile: it replaces the held one, the lists are not reloaded.
  const onSaved = useCallback(
    (profile: MyProfile) => {
      saves.saved(profile)
      update((d) => ({ ...d, profile }))
    },
    [saves, update],
  )
  const { categories } = useCategories()
  const me = useMe()
  const [taxAsked, setTaxAsked] = useState(0) // the tax number step opens the field in the payout card
  // Arriving from the last Done with ?publish=1: back to the top, with the Publish switch briefly highlighted.
  const scrollRef = useRef<ComponentRef<typeof KeyboardAwareScrollView>>(null)
  const [highlight, setHighlight] = useState(false)
  useEffect(() => {
    if (!params.publish || !done) return
    scrollRef.current?.scrollTo({ y: 0, animated: true })
    setHighlight(true)
    const timer = setTimeout(() => setHighlight(false), 2500)
    return () => clearTimeout(timer)
  }, [params.publish, done])
  const title = welcome ? t('setup.welcome') : t('setup.title')
  if (!done || !data) return <FormScreen title={title}>{error ? <ErrorRetry code={error} onRetry={retry} /> : <Loading />}</FormScreen>
  const { profile, services, references, photos, verifications } = data
  const name = profile.publicName ?? ''
  const docRows = documentRows(services, categories ?? [], verifications)

  return (
    <FormScreen title={title} scrollRef={scrollRef}>
      <PublishBar highlight={highlight} profile={profile} services={services} docRows={docRows} onChanged={retry} onSaved={onSaved} onTaxId={() => setTaxAsked((n) => n + 1)} />
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

      <PayoutCard profile={profile} onSaved={onSaved} taxAsked={taxAsked} />

      <ServicesCard services={services} docRows={docRows} />

      <AboutCard profile={profile} />

      <ReferencesCard references={references} />
      <PortfolioCard photos={photos.filter((p) => p.kind === 'portfolio')} name={name} onChanged={retry} />
      {docRows.some((r) => r.optional) && <Info text={t('setup.documentsExtra')} />}
      {docRows.length > 0 && <DocumentsCard rows={docRows} />}
      <InvoicesCard me={me} />
    </FormScreen>
  )
}

const styles = StyleSheet.create({
  name: { fontSize: 17, fontWeight: '700', color: color.ink },
  status: { fontSize: 14, color: color.inkMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1 },
})
