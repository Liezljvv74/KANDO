import { DEFAULT_ACTION_IDENTIFIER, clearLastNotificationResponse, setNotificationHandler, useLastNotificationResponse } from 'expo-notifications'
import { Fraunces_700Bold, Fraunces_900Black } from '@expo-google-fonts/fraunces'
import { CourierPrime_700Bold } from '@expo-google-fonts/courier-prime'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { KeyboardProvider } from 'react-native-keyboard-controller'

import { Button } from '@/components/auth-ui'
import { TermsReaccept } from '@/components/terms-reaccept'
import { isAuthBusy, useSession } from '@/hooks/use-session'
import { t, useLang } from '@/i18n'
import { go } from '@/lib/go'
import { pushRoute } from '@/lib/push'
import { color } from '@/theme'

// A push that arrives while the app is open still shows as a banner.
setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
})

export default function RootLayout() {
  const { user, loading, offline, retry } = useSession()
  useLang()
  usePushTaps(!!user)
  // The shop type; if it fails to load the app still opens with the system font.
  const [fontsReady, fontError] = useFonts({ Fraunces_700Bold, Fraunces_900Black, CourierPrime_700Bold })
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
      <Stack screenOptions={{ headerShown: false }}>
        {/* SDK 58 sends a closed guard to "/" by default, which only exists while logged in: logout showed "Unmatched Route". */}
        <Stack.Protected guard={!!user} redirectTo="/welcome">
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
        <Stack.Protected guard={!user}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
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
    if (route) go(route)
  }, [signedIn, response])
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  text: { fontSize: 16, color: color.ink, textAlign: 'center' },
})
