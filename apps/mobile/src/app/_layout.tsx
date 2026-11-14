import {
  DEFAULT_ACTION_IDENTIFIER,
  clearLastNotificationResponse,
  setNotificationHandler,
  useLastNotificationResponse,
} from 'expo-notifications'
import { Fraunces_700Bold, Fraunces_900Black } from '@expo-google-fonts/fraunces'
import { CourierPrime_700Bold } from '@expo-google-fonts/courier-prime'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { KeyboardProvider } from 'react-native-keyboard-controller'

import { ApiError, updateMe } from '@/api/client'
import { removeKey } from '@/lib/pending-saves'
import { saveMyProfile, servicesApi } from '@/api/my-profile'
import { Button } from '@/components/auth-ui'
import { PendingBanner, showServiceGone } from '@/components/pending-banner'
import { TermsReaccept } from '@/components/terms-reaccept'
import { isAuthBusy, useSession } from '@/hooks/use-session'
import { t, useLang } from '@/i18n'
import { refusedField } from '@/lib/account-autosave'
import { go } from '@/lib/go'
import { registerSender, startRunner, wake } from '@/lib/pending-runner'
import { pushRoute } from '@/lib/push'
import { serviceCreateSender } from '@/lib/serial-create'
import { color } from '@/theme'

// A push that arrives while the app is open still shows as a banner.
setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

registerSender('about', async (e) => void (await saveMyProfile(e.body as object)))
registerSender('service-field', async (e) => {
  // Never against a temporary id. The runner holds a field back while its create is kept, so one that arrives here has
  // lost its create (too old, or discarded): it can never be sent and is dropped, not retried for good under a banner.
  if (!e.serviceRef || e.serviceRef.startsWith('tmp:')) return removeKey(e.key, e.accountId)
  await servicesApi.update(e.serviceRef, e.body as object)
})
registerSender(
  'account',
  async (e) => void (await updateMe(e.body as Parameters<typeof updateMe>[0])),
  (err) => (err instanceof ApiError ? refusedField(err) : undefined),
)
registerSender('service-create', serviceCreateSender(servicesApi))

export default function RootLayout() {
  const { user, loading, offline, retry } = useSession()
  useLang()
  usePushTaps(!!user)
  const userId = useRef<string | null>(null)
  userId.current = user?.id ?? null
  useEffect(() => startRunner(() => userId.current, { onServiceGone: showServiceGone }), [])
  useEffect(() => wake(), [user?.id])
  // The shop type; if it fails to load the app still opens with the system font.
  const [fontsReady, fontError] = useFonts({
    Fraunces_700Bold,
    Fraunces_900Black,
    CourierPrime_700Bold,
  })
  const [fontsLate, setFontsLate] = useState(false) // a font that hangs never keeps the app on the spinner
  useEffect(() => {
    const timer = setTimeout(() => setFontsLate(true), 4000)
    return () => clearTimeout(timer)
  }, [])
  if (loading || offline || (!fontsReady && !fontError && !fontsLate)) {
    return (
      <View style={styles.center}>
        {loading || !offline ? null : ( // blank while the session or the fonts load (no spinner); the offline notice only once loading is over
          <>
            <Text style={styles.text}>{t(isAuthBusy() ? 'error.authBusy' : 'error.network')}</Text>
            <Button label={t('common.retry')} onPress={retry} />
          </>
        )}
      </View>
    )
  }
  return (
    <KeyboardProvider>
      <StatusBar style="dark" />
      <PendingBanner>
        <Stack screenOptions={{ headerShown: false }}>
          {/* The tabs are open to everyone (a signed-out person browses; private screens ask for a login). The auth screens are for signed-out people only. */}
          <Stack.Screen name="(tabs)" />
          <Stack.Protected guard={!user}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
        </Stack>
      </PendingBanner>
      {user && <TermsReaccept />}
    </KeyboardProvider>
  )
}

/** A tapped push (also the one that launched the app) opens its booking, thread or invoice once signed in; any other link is ignored. */
function usePushTaps(signedIn: boolean) {
  const response = useLastNotificationResponse()
  useEffect(() => {
    if (!signedIn || !response || response.actionIdentifier !== DEFAULT_ACTION_IDENTIFIER) return
    clearLastNotificationResponse()
    const route = pushRoute(response.notification.request.content.data?.url)
    // One tick later: after a login this effect runs in the very commit that removes the sign-in screens, and a navigation made
    // inside it was overridden (the person ended on Home, the booking never opened). Same reason as in the tabs layout.
    if (route) setTimeout(() => go(route), 0)
  }, [signedIn, response])
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: color.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  text: { fontSize: 16, color: color.ink, textAlign: 'center' },
})
