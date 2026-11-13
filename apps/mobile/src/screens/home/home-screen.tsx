import { router, useFocusEffect } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { HelpFeedbackButtons } from '@/components/help-feedback-buttons'
import { LanguageSwitch } from '@/components/language-switch'
import { Rise, Stamp, Tag } from '@/components/shop-ui'
import { ErrorText } from '@/components/auth-ui'
import { loadMe, useMe } from '@/hooks/use-me'
import { useSession } from '@/hooks/use-session'
import { t, useLang, type Key } from '@/i18n'
import { consumeAfterLogin, setAfterLogin } from '@/lib/after-login'
import { peekPending } from '@/lib/pending-navigation'
import { showProfileTab } from '@/lib/profile-tab'
import { startOffering } from '@/lib/start-offering'
import { color, font } from '@/theme'

/** "Finally\nSomeone who can" -> ["FINALLY", "Someone who can"]: the first word in capitals and mint, the rest in teal. */
const splitHeadline = (s: string): [string, string] => {
  const i = s.indexOf('\n')
  return i < 0 ? [s.toUpperCase(), ''] : [s.slice(0, i).toUpperCase(), s.slice(i + 1)]
}

/** The one Home screen: three choices (help, offer, learn more). Signed out it is the first screen (log in, language); signed in the same choices. */
export default function HomeScreen() {
  useLang()
  const top = useSafeAreaInsets().top
  const me = useMe()
  const signedIn = !!useSession().user
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useFocusEffect(
    useCallback(() => {
      if (!signedIn) return // signed out there is no account to load
      loadMe().catch(() => {})
      // "I need help" was tapped before logging in or signing up: go to the search page now (unless the person asked to offer services, which opens their profile).
      consumeAfterLogin().then((dest) => {
        if (dest && !peekPending()) router.navigate('/search')
      })
    }, [signedIn]),
  )
  const head = splitHeadline(t('home.heroHeadline'))

  const offer = async () => {
    if (showProfileTab(me)) return router.navigate('/my-profile')
    setBusy(true)
    setProblem(null)
    setProblem(await startOffering())
    setBusy(false)
  }
  const choices: { title: Key; text: Key; onPress: () => void; main?: boolean; tone?: 'indigo' | 'teal' }[] = signedIn
    ? [
        { title: 'welcome.needHelp', text: 'welcome.needHelpText', onPress: () => router.navigate('/search'), main: true },
        { title: 'welcome.offer', text: 'welcome.offerText', onPress: offer, tone: 'indigo' },
        { title: 'welcome.learn', text: 'welcome.learnText', onPress: () => router.push('/learn'), tone: 'teal' },
      ]
    : [
        { title: 'welcome.needHelp', text: 'welcome.needHelpText', onPress: () => { void setAfterLogin('/search'); router.push('/sign-up') }, main: true },
        { title: 'welcome.offer', text: 'welcome.offerText', onPress: () => { void setAfterLogin(null); router.push('/sign-up?offer=1') }, tone: 'indigo' },
        { title: 'welcome.learn', text: 'welcome.learnText', onPress: () => { void setAfterLogin(null); router.push('/how-it-works') }, tone: 'teal' },
      ]

  return (
    <View style={[styles.root, !signedIn && styles.rootOut, { paddingTop: top }]}>
      {!signedIn && <StatusBar style="light" />}
      <ScrollView contentContainerStyle={styles.content}>
        {!signedIn && (
          <View style={styles.header}>
            <View style={styles.brandTag}>
              <Text style={styles.brand}>{t('brand.name')}</Text>
            </View>
            <Pressable accessibilityRole="link" onPress={() => { void setAfterLogin(null); router.push('/login') }} hitSlop={12} style={styles.loginHit}>
              <Text style={styles.link}>{t('welcome.logInRegister')}</Text>
            </Pressable>
          </View>
        )}
        <View style={signedIn ? styles.hero : styles.heroOut}>
          <Text style={styles.headline} accessibilityRole="header">
            {head[0]}
            {'\n'}
            <Text style={styles.headlineRest}>{head[1]}</Text>
          </Text>
          <Stamp label={t('home.stamp')} />
          <View style={styles.heroButtons}>
            <HelpFeedbackButtons />
          </View>
        </View>
        {choices.map(({ title, text, onPress, main, tone }, i) => (
          <Rise key={title} index={i}>
            <Pressable accessibilityRole="button" onPress={onPress} disabled={busy && title === 'welcome.offer'} style={({ pressed }) => pressed && styles.pressed}>
              <Tag style={main ? styles.main : tone ? styles[tone] : undefined}>
                <View style={styles.row}>
                  <Text style={styles.cardTitle}>{t(title)}</Text>
                  <Text style={styles.cardTitle}>→</Text>
                </View>
                <Text style={styles.cardText}>{t(text)}</Text>
              </Tag>
            </Pressable>
          </Rise>
        ))}
        <ErrorText text={problem} />
        {!signedIn && (
          <Tag>
            <LanguageSwitch />
          </Tag>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { padding: 16, gap: 12 },
  rootOut: { backgroundColor: color.indigo },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  brandTag: { backgroundColor: color.bg, borderWidth: 2, borderColor: color.teal, paddingHorizontal: 12, paddingVertical: 6, transform: [{ rotate: '-3deg' }] },
  brand: { fontFamily: font.tag, fontSize: 15, letterSpacing: 1, color: color.ink },
  loginHit: { minHeight: 44, justifyContent: 'center' },
  link: { fontSize: 15, fontWeight: '700', color: color.bg, textDecorationLine: 'underline' },
  hero: { backgroundColor: color.indigo, borderRadius: 8, padding: 20, gap: 16 },
  heroOut: { gap: 16, marginTop: 16, marginBottom: 8 },
  heroButtons: { alignSelf: 'flex-end' },
  headline: { fontFamily: font.display, fontSize: 40, lineHeight: 43, color: color.bg },
  headlineRest: { color: color.teal },
  main: { borderStyle: 'solid', borderColor: color.teal, backgroundColor: color.bg },
  // each choice its own colour, all with a solid line: need help (clear), offer (light indigo), learn more (light teal)
  indigo: { borderStyle: 'solid', borderColor: color.indigo, backgroundColor: color.surface },
  teal: { borderStyle: 'solid', borderColor: color.teal, backgroundColor: '#D3F3F0' },
  pressed: { opacity: 0.75 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  cardTitle: { fontFamily: font.heading, fontSize: 19, color: color.ink },
  cardText: { fontSize: 15, lineHeight: 21, color: color.inkMuted, marginTop: 4 },
})
