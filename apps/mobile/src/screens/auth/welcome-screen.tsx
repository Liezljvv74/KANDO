import { useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { LanguageSwitch } from '@/components/language-switch'
import { Rise, Stamp, Tag } from '@/components/shop-ui'
import { t, useLang, type Key } from '@/i18n'
import { color, font } from '@/theme'

type Card = { title: Key; text: Key; href: '/sign-up' | '/sign-up?offer=1' | '/how-it-works'; main?: boolean }
const CARDS: Card[] = [
  { title: 'welcome.needHelp', text: 'welcome.needHelpText', href: '/sign-up', main: true },
  { title: 'welcome.offer', text: 'welcome.offerText', href: '/sign-up?offer=1' },
  { title: 'welcome.learn', text: 'welcome.learnText', href: '/how-it-works' },
]

/** "Finally Someone who can" -> ["FINALLY", "Someone who can"]: the first word in capitals and mint, the rest in teal. */
export const splitHeadline = (s: string): [string, string] => {
  const i = s.indexOf(' ')
  return i < 0 ? [s.toUpperCase(), ''] : [s.slice(0, i).toUpperCase(), s.slice(i + 1)]
}

/** The first screen when signed out: the shop sign in the KANDO colours. */
export default function WelcomeScreen() {
  useLang()
  const router = useRouter()
  const [first, rest] = splitHeadline(t('home.headline'))
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.brandTag}>
            <Text style={styles.brand}>{t('brand.name')}</Text>
          </View>
          <Pressable accessibilityRole="link" onPress={() => router.push('/login')} hitSlop={12} style={styles.loginHit}>
            <Text style={styles.link}>{t('welcome.logInRegister')}</Text>
          </Pressable>
        </View>
        <Text style={styles.headline} accessibilityRole="header">
          {first}
          {'\n'}
          <Text style={styles.headlineRest}>{rest}</Text>
        </Text>
        <Stamp label={t('home.stamp')} />
        <View style={styles.cards}>
          {CARDS.map(({ title, text, href, main }, i) => (
            <Rise key={title} index={i}>
              <Pressable accessibilityRole="button" onPress={() => router.push(href)} style={({ pressed }) => pressed && styles.pressed}>
                <Tag style={main ? styles.main : undefined}>
                  <View style={styles.row}>
                    <Text style={styles.cardTitle}>{t(title)}</Text>
                    <Text style={styles.cardTitle}>→</Text>
                  </View>
                  <Text style={styles.cardText}>{t(text)}</Text>
                </Tag>
              </Pressable>
            </Rise>
          ))}
        </View>
        <Tag>
          <LanguageSwitch />
        </Tag>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.indigo },
  content: { padding: 20, gap: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brandTag: { backgroundColor: color.bg, borderWidth: 2, borderColor: color.teal, paddingHorizontal: 12, paddingVertical: 6, transform: [{ rotate: '-3deg' }] },
  brand: { fontFamily: font.tag, fontSize: 15, letterSpacing: 1, color: color.ink },
  loginHit: { minHeight: 44, justifyContent: 'center' },
  link: { fontSize: 15, fontWeight: '700', color: color.bg, textDecorationLine: 'underline' },
  headline: { fontFamily: font.display, fontSize: 44, lineHeight: 46, color: color.bg, marginTop: 24 },
  headlineRest: { color: color.teal },
  cards: { gap: 12, marginTop: 8 },
  main: { borderStyle: 'solid', borderColor: color.teal, backgroundColor: color.bg },
  pressed: { opacity: 0.75 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  cardTitle: { fontFamily: font.heading, fontSize: 19, color: color.ink },
  cardText: { fontSize: 15, lineHeight: 21, color: color.inkMuted, marginTop: 4 },
})
