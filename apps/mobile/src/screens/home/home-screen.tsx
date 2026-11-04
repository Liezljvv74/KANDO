import { router, useFocusEffect } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as SecureStore from 'expo-secure-store'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { photosApi } from '@/api/my-profile'
import { Button, ErrorText } from '@/components/auth-ui'
import { Card } from '@/components/form-ui'
import { LanguageSwitch } from '@/components/language-switch'
import { NotificationBanners } from '@/components/notification-banner'
import { Rise, Stamp, Tag } from '@/components/shop-ui'
import { loadMe, useMe } from '@/hooks/use-me'
import { useSession } from '@/hooks/use-session'
import { errorText, t, useLang, type Key } from '@/i18n'
import { consumeAfterLogin, setAfterLogin } from '@/lib/after-login'
import { askPhotoSource } from '@/lib/ask-photo-source'
import { peekPending } from '@/lib/pending-navigation'
import { pictureNudgeKey } from '@/lib/picture-nudge'
import { pickPhoto, uploadErrorCode } from '@/lib/pick'
import { showProfileTab } from '@/lib/profile-tab'
import { startOffering } from '@/lib/start-offering'
import { color, font } from '@/theme'

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

/** "Finally Someone who can" -> ["FINALLY", "Someone who can"]: the first word in capitals and mint, the rest in teal. */
const splitHeadline = (s: string): [string, string] => {
  const i = s.indexOf(' ')
  return i < 0 ? [s.toUpperCase(), ''] : [s.slice(0, i).toUpperCase(), s.slice(i + 1)]
}

/** The one Home screen: three choices (help, offer, learn more). Signed out it is the first screen (log in, language); signed in it adds the notifications and the picture prompt. */
export default function HomeScreen() {
  useLang()
  const me = useMe()
  const signedIn = !!useSession().user
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useFocusEffect(
    useCallback(() => {
      if (!signedIn) return // signed out there is no account to load
      loadMe().catch(() => {})
      // "I need help" was tapped before logging in or signing up: go to the search page now (unless the person asked to offer services, which opens their profile).
      if (consumeAfterLogin() && !peekPending()) router.navigate('/search')
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
  const choices: { title: Key; text: Key; onPress: () => void; main?: boolean }[] = signedIn
    ? [
        { title: 'welcome.needHelp', text: 'welcome.needHelpText', onPress: () => router.navigate('/search'), main: true },
        { title: 'welcome.offer', text: 'welcome.offerText', onPress: offer },
        { title: 'welcome.learn', text: 'welcome.learnText', onPress: () => router.push('/learn') },
      ]
    : [
        { title: 'welcome.needHelp', text: 'welcome.needHelpText', onPress: () => { setAfterLogin('/search'); router.push('/sign-up') }, main: true },
        { title: 'welcome.offer', text: 'welcome.offerText', onPress: () => { setAfterLogin(null); router.push('/sign-up?offer=1') } },
        { title: 'welcome.learn', text: 'welcome.learnText', onPress: () => { setAfterLogin(null); router.push('/how-it-works') } },
      ]

  return (
    <SafeAreaView style={signedIn ? styles.root : [styles.root, styles.rootOut]} edges={['top']}>
      {!signedIn && <StatusBar style="light" />}
      <ScrollView contentContainerStyle={styles.content}>
        {!signedIn && (
          <View style={styles.header}>
            <View style={styles.brandTag}>
              <Text style={styles.brand}>{t('brand.name')}</Text>
            </View>
            <Pressable accessibilityRole="link" onPress={() => router.push('/login')} hitSlop={12} style={styles.loginHit}>
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
        </View>
        {signedIn && <NotificationBanners me={me} />}
        {signedIn && <PictureNudge />}
        {choices.map(({ title, text, onPress, main }, i) => (
          <Rise key={title} index={i}>
            <Pressable accessibilityRole="button" onPress={onPress} disabled={busy && title === 'welcome.offer'} style={({ pressed }) => pressed && styles.pressed}>
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
        <ErrorText text={problem} />
        {!signedIn && (
          <Tag>
            <LanguageSwitch />
          </Tag>
        )}
      </ScrollView>
    </SafeAreaView>
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
  headline: { fontFamily: font.display, fontSize: 40, lineHeight: 43, color: color.bg },
  headlineRest: { color: color.teal },
  main: { borderStyle: 'solid', borderColor: color.teal, backgroundColor: color.bg },
  pressed: { opacity: 0.75 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  cardTitle: { fontFamily: font.heading, fontSize: 19, color: color.ink },
  cardText: { fontSize: 15, lineHeight: 21, color: color.inkMuted, marginTop: 4 },
  body: { fontSize: 15, lineHeight: 22, color: color.ink },
  dismiss: { position: 'absolute', top: 0, right: 0, padding: 12, fontSize: 28, lineHeight: 32, color: color.ink },
})
