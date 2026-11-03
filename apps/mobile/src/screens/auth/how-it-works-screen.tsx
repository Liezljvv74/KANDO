import { useRouter } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/auth-ui'
import { t, useLang, type Key } from '@/i18n'

const GROUPS: { title: Key; steps: [Key, Key, Key]; bg: string }[] = [
  { title: 'home.customerTitle', steps: ['home.customer1', 'home.customer2', 'home.customer3'], bg: '#DCEFE8' },
  { title: 'home.providerTitle', steps: ['home.provider1', 'home.provider2', 'home.provider3'], bg: '#FFF6E8' },
]
const SAFETY: [Key, Key][] = [
  ['home.payment', 'home.paymentText'],
  ['home.safetyVerified', 'home.safetyVerifiedText'],
  ['home.safetyReviews', 'home.safetyReviewsText'],
  ['home.safetyEu', 'home.safetyEuText'],
]

export default function HowItWorksScreen() {
  useLang()
  const router = useRouter()
  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityRole="link" onPress={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))} hitSlop={12}>
          <Text style={styles.link}>← {t('welcome.backHome')}</Text>
        </Pressable>
        <Text style={styles.title}>{t('welcome.howTitle')}</Text>
        {GROUPS.map(({ title, steps, bg }) => (
          <View key={title} style={[styles.box, { backgroundColor: bg }]}>
            <Text style={styles.boxTitle}>{t(title)}</Text>
            {steps.map((s, i) => (
              <Text key={s} style={styles.text}>
                {i + 1}. {t(s)}
              </Text>
            ))}
          </View>
        ))}
        <Text style={styles.sub}>{t('home.safetyTitle')}</Text>
        {SAFETY.map(([title, text]) => (
          <View key={title} style={styles.safe}>
            <Text style={styles.boxTitle}>{t(title)}</Text>
            <Text style={styles.text}>{t(text)}</Text>
          </View>
        ))}
        <Button label={t('welcome.register')} onPress={() => router.push('/sign-up')} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2FBF8' },
  content: { padding: 16, gap: 16 },
  link: { fontSize: 15, fontWeight: '600', color: '#0E8A6B' },
  title: { fontSize: 28, fontWeight: '800', color: '#14352E' },
  box: { borderRadius: 16, padding: 16, gap: 8 },
  boxTitle: { fontSize: 17, fontWeight: '700', color: '#14352E' },
  text: { fontSize: 15, lineHeight: 21, color: '#14352E' },
  sub: { fontSize: 22, fontWeight: '800', color: '#14352E', marginTop: 8 },
  safe: { gap: 4 },
})
