import { router, useFocusEffect } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import { useCallback, useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { photosApi } from '@/api/my-profile'
import { Button, ErrorText } from '@/components/auth-ui'
import { Card } from '@/components/form-ui'
import { NotificationBanners } from '@/components/notification-banner'
import { Select } from '@/components/select'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useCategories } from '@/hooks/use-categories'
import { loadMe, useMe } from '@/hooks/use-me'
import { errorText, t, useLang, type Key } from '@/i18n'
import { showProfileTab } from '@/lib/profile-tab'
import { startOffering } from '@/lib/start-offering'
import { askPhotoSource } from '@/lib/ask-photo-source'
import { pictureNudgeKey } from '@/lib/picture-nudge'
import { pickPhoto, uploadErrorCode } from '@/lib/pick'

/** [title, text] per card. */
const BADGES: [Key, Key][] = [
  ['home.badgeVerified', 'home.badgeVerifiedText'],
  ['home.payment', 'home.paymentBadgeText'],
  ['home.badgeNoFees', 'home.badgeNoFeesText'],
]
const SAFETY: [Key, Key][] = [
  ['home.payment', 'home.paymentText'],
  ['home.safetyVerified', 'home.safetyVerifiedText'],
  ['home.safetyReviews', 'home.safetyReviewsText'],
  ['home.safetyEu', 'home.safetyEuText'],
]
const STEPS = [1, 2, 3] as const

/** Shown while the person has no picture and has not dismissed it; the account picture serves customers and providers alike. */
function PictureNudge() {
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

/** "Become a provider": opens the profile page (creating the draft first); not for people who already have the My profile tab. */
function ProviderCard() {
  const me = useMe()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  if (showProfileTab(me)) return null
  const go = async () => {
    setBusy(true)
    setProblem(null)
    setProblem(await startOffering())
    setBusy(false)
  }
  return (
    <View style={[styles.panel, styles.panelWarm]}>
      <Text style={styles.h2} accessibilityRole="header">
        {t('home.providersTitle')}
      </Text>
      <Text style={styles.body}>{t('home.providersText')}</Text>
      <ErrorText text={problem} />
      <Button label={t('home.becomeProvider')} onPress={go} busy={busy} />
    </View>
  )
}

export default function HomeScreen() {
  useLang()
  const { categories, error, retry } = useCategories()
  const me = useMe()
  useFocusEffect(useCallback(() => { loadMe().catch(() => {}) }, []))
  const k = (key: string) => t(`home.${key}` as Key)

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.headline} accessibilityRole="header">
          {k('headline')}
        </Text>
        <Text style={styles.intro}>{k('intro')}</Text>
        <NotificationBanners me={me} />
        <PictureNudge />
        <Button label={t('home.cta')} onPress={() => router.navigate('/search')} />
        <ProviderCard />
        {categories ? (
          // Every pick starts a fresh search, even the same category again (`at` changes).
          <Select
            label={k('categoriesTitle')}
            hideLabel
            options={categories.map((c) => ({ value: c.slug, label: c.name }))}
            value={null}
            placeholder={k('categoriesTitle')}
            searchable
            hint={t('search.categoryHint')}
            onChange={(slug) => router.navigate({ pathname: '/search', params: { category: slug, at: String(Date.now()) } })}
          />
        ) : error ? (
          <ErrorRetry code={error} onRetry={retry} />
        ) : (
          <Loading />
        )}
        {BADGES.map(([title, text]) => (
          <View key={title} style={styles.card}>
            <Text style={styles.bold}>{t(title)}</Text>
            <Text style={styles.body}>{t(text)}</Text>
          </View>
        ))}

        <Text style={styles.h2} accessibilityRole="header">
          {k('howTitle')}
        </Text>
        {(['customer', 'provider'] as const).map((who) => (
          <View key={who} style={[styles.panel, who === 'provider' && styles.panelWarm]}>
            <Text style={styles.h3}>{k(`${who}Title`)}</Text>
            {STEPS.map((n) => (
              <Text key={n} style={styles.body}>
                {n}. {k(`${who}${n}`)}
              </Text>
            ))}
          </View>
        ))}

        <Text style={styles.h2} accessibilityRole="header">
          {k('safetyTitle')}
        </Text>
        {SAFETY.map(([title, text]) => (
          <View key={title} style={styles.safety}>
            <Text style={styles.h3}>{t(title)}</Text>
            <Text style={styles.body}>{t(text)}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2FBF8' },
  content: { padding: 16, gap: 12 },
  headline: { fontSize: 24, fontWeight: '800', color: '#14352E' },
  intro: { fontSize: 16, lineHeight: 22, color: '#14352E' },
  card: { borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#CDEDE3', padding: 12, gap: 2 },
  bold: { fontSize: 15, fontWeight: '700', color: '#14352E' },
  body: { fontSize: 15, lineHeight: 22, color: '#14352E' },
  h2: { fontSize: 20, fontWeight: '800', color: '#14352E', marginTop: 4 },
  h3: { fontSize: 16, fontWeight: '700', color: '#14352E' },
  panel: { borderRadius: 12, backgroundColor: '#E1F4EE', padding: 12, gap: 4 },
  panelWarm: { backgroundColor: '#FFF7E8' },
  safety: { gap: 2 },
  dismiss: { position: 'absolute', top: 0, right: 0, padding: 12, fontSize: 28, lineHeight: 32, color: '#14352E' },
})
