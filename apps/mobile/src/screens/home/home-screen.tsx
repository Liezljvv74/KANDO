import { router } from 'expo-router'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/auth-ui'
import { Select } from '@/components/select'
import { ErrorRetry, Loading } from '@/components/state-view'
import { useCategories } from '@/hooks/use-categories'
import { t, useLang, type Key } from '@/i18n'

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

export default function HomeScreen() {
  useLang()
  const { categories, error, retry } = useCategories()
  const k = (key: string) => t(`home.${key}` as Key)

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.headline} accessibilityRole="header">
          {k('headline')}
        </Text>
        <Text style={styles.intro}>{k('intro')}</Text>
        <Button label={t('home.cta')} onPress={() => router.navigate('/search')} />
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

        <View style={[styles.panel, styles.panelWarm]}>
          <Text style={styles.h2} accessibilityRole="header">
            {k('providersTitle')}
          </Text>
          <Text style={styles.body}>{k('providersText')}</Text>
          <Button label={t('home.becomeProvider')} onPress={() => router.navigate('/my-profile')} />
        </View>
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
})
