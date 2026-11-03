import { useRouter } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { LanguageSwitch } from '@/components/language-switch'
import { t, useLang, type Key } from '@/i18n'

type Card = { title: Key; text: Key; href: '/sign-up' | '/sign-up?offer=1' | '/how-it-works'; tone: 'green' | 'sand' | 'mint' }
const CARDS: Card[] = [
  { title: 'welcome.needHelp', text: 'welcome.needHelpText', href: '/sign-up', tone: 'green' },
  { title: 'welcome.offer', text: 'welcome.offerText', href: '/sign-up?offer=1', tone: 'sand' },
  { title: 'welcome.learn', text: 'welcome.learnText', href: '/how-it-works', tone: 'mint' },
]

/** The first screen when signed out. */
export default function WelcomeScreen() {
  useLang()
  const router = useRouter()
  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.brand}>{t('brand.name')}</Text>
          <Pressable accessibilityRole="link" onPress={() => router.push('/login')} hitSlop={12}>
            <Text style={styles.link}>{t('welcome.logInRegister')}</Text>
          </Pressable>
        </View>
        <Text style={styles.headline}>{t('home.headline')}</Text>
        {CARDS.map(({ title, text, href, tone }) => (
          <Pressable
            key={title}
            accessibilityRole="button"
            onPress={() => router.push(href)}
            style={({ pressed }) => [styles.card, styles[tone], pressed && styles.pressed]}>
            <View style={styles.row}>
              <Text style={[styles.cardTitle, tone === 'green' && styles.onGreen]}>{t(title)}</Text>
              <Text style={[styles.cardTitle, tone === 'green' && styles.onGreen]}>→</Text>
            </View>
            <Text style={[styles.cardText, tone === 'green' && styles.onGreen]}>{t(text)}</Text>
          </Pressable>
        ))}
        <LanguageSwitch />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F2FBF8' },
  content: { padding: 16, gap: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { fontSize: 20, fontWeight: '800', color: '#14352E' },
  link: { fontSize: 15, fontWeight: '600', color: '#0E8A6B' },
  headline: { fontSize: 34, fontWeight: '800', lineHeight: 40, color: '#14352E', marginTop: 32, marginBottom: 8 },
  card: { borderRadius: 16, borderWidth: 1, padding: 18, gap: 8 },
  green: { backgroundColor: '#0E8A6B', borderColor: '#0E8A6B' },
  sand: { backgroundColor: '#FFF6E8', borderColor: '#F3E3C8' },
  mint: { backgroundColor: '#DCEFE8', borderColor: '#C6E3D8' },
  pressed: { opacity: 0.7 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#14352E' },
  cardText: { fontSize: 15, lineHeight: 21, color: '#14352E' },
  onGreen: { color: '#fff' },
})
