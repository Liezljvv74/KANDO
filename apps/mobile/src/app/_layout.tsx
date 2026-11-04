import { DEFAULT_ACTION_IDENTIFIER, clearLastNotificationResponse, setNotificationHandler, useLastNotificationResponse } from 'expo-notifications'
import { Fraunces_700Bold, Fraunces_900Black } from '@expo-google-fonts/fraunces'
import { CourierPrime_700Bold } from '@expo-google-fonts/courier-prime'
import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { KeyboardProvider } from 'react-native-keyboard-controller'

import { Button } from '@/components/auth-ui'
import { isAuthBusy, useSession } from '@/hooks/use-session'
import { t, useLang } from '@/i18n'
import { go } from '@/lib/go'
import { pushRoute } from '@/lib/push'

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
  if (loading || offline || (!fontsReady && !fontError)) {
    return (
      <View style={styles.center}>
        {loading || !offline ? (
          <ActivityIndicator size="large" color="#34328A" />
        ) : (
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
          <Stack.Screen name="provider/[slug]" />
          <Stack.Screen name="my-profile" />
          <Stack.Screen name="bookings" />
          <Stack.Screen name="threads" />
          <Stack.Screen name="invoices" />
        </Stack.Protected>
        <Stack.Protected guard={!user}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
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
  center: { flex: 1, backgroundColor: '#E3F6EE', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  text: { fontSize: 16, color: '#1D1C4A', textAlign: 'center' },
})
