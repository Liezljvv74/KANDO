import { router, useFocusEffect } from 'expo-router'
import * as SecureStore from 'expo-secure-store'
import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { photosApi } from '@/api/my-profile'
import { Button, ErrorText } from '@/components/auth-ui'
import { Card } from '@/components/form-ui'
import { NotificationBanners } from '@/components/notification-banner'
import { Rise, Stamp, Tag } from '@/components/shop-ui'
import { loadMe, useMe } from '@/hooks/use-me'
import { errorText, t, useLang, type Key } from '@/i18n'
import { askPhotoSource } from '@/lib/ask-photo-source'
import { pictureNudgeKey } from '@/lib/picture-nudge'
import { pickPhoto, uploadErrorCode } from '@/lib/pick'
import { showProfileTab } from '@/lib/profile-tab'
import { startOffering } from '@/lib/start-offering'
import { splitHeadline } from '@/screens/auth/welcome-screen'
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

/** The signed-in Home: the same three choices as the welcome screen (help, offer, learn more). */
export default function HomeScreen() {
  useLang()
  const me = useMe()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  useFocusEffect(useCallback(() => { loadMe().catch(() => {}) }, []))
  const head = splitHeadline(t('home.headline'))

  const offer = async () => {
    if (showProfileTab(me)) return router.navigate('/my-profile')
    setBusy(true)
    setProblem(null)
    setProblem(await startOffering())
    setBusy(false)
  }
  const choices: { title: Key; text: Key; onPress: () => void; main?: boolean }[] = [
    { title: 'welcome.needHelp', text: 'welcome.needHelpText', onPress: () => router.navigate('/search'), main: true },
    { title: 'welcome.offer', text: 'welcome.offerText', onPress: offer },
    { title: 'welcome.learn', text: 'welcome.learnText', onPress: () => router.push('/learn') },
  ]

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.headline} accessibilityRole="header">
            {head[0]}
            {'\n'}
            <Text style={styles.headlineRest}>{head[1]}</Text>
          </Text>
          <Stamp label={t('home.stamp')} />
        </View>
        <NotificationBanners me={me} />
        <PictureNudge />
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
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { padding: 16, gap: 12 },
  hero: { backgroundColor: color.indigo, borderRadius: 8, padding: 20, gap: 16 },
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
