import { useRouter } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button } from '@/components/auth-ui'
import { useSession } from '@/hooks/use-session'
import { t, useLang, type Key } from '@/i18n'
import { font } from '@/theme'

const GROUPS: { title: Key; steps: [Key, Key, Key]; bg: string }[] = [
  { title: 'home.customerTitle', steps: ['home.customer1', 'home.customer2', 'home.customer3'], bg: '#CFE6DC' },
  { title: 'home.providerTitle', steps: ['home.provider1', 'home.provider2', 'home.provider3'], bg: '#FFFFFF' },
]
const SAFETY: [Key, Key][] = [
  ['home.payment', 'howto.paymentText'],
  ['home.safetyVerified', 'howto.verifiedText'],
  ['howto.reviewsTitle', 'home.safetyReviewsText'],
  ['home.safetyEu', 'home.safetyEuText'],
]

export default function HowItWorksScreen() {
  useLang()
  const router = useRouter()
  const signedIn = !!useSession().user // signed in: back goes to Home and there is nothing to register for
  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityRole="link" onPress={() => (router.canGoBack() ? router.back() : router.replace(signedIn ? '/' : '/welcome'))} hitSlop={12}>
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
        {!signedIn && <Button label={t('welcome.register')} onPress={() => router.push('/sign-up')} />}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#E3F6EE' },
  content: { padding: 16, gap: 16 },
  link: { fontSize: 15, fontWeight: '600', color: '#34328A' },
  title: { fontSize: 28, fontFamily: font.heading, color: '#1D1C4A' },
  box: { borderRadius: 6, padding: 16, gap: 8 },
  boxTitle: { fontSize: 17, fontFamily: font.heading, color: '#1D1C4A' },
  text: { fontSize: 15, lineHeight: 21, color: '#1D1C4A' },
  sub: { fontSize: 22, fontFamily: font.heading, color: '#1D1C4A', marginTop: 8 },
  safe: { gap: 4 },
})
