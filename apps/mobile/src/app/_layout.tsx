import { DEFAULT_ACTION_IDENTIFIER, clearLastNotificationResponse, setNotificationHandler, useLastNotificationResponse } from 'expo-notifications'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import { Button } from '@/components/auth-ui'
import { useSession } from '@/hooks/use-session'
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
  if (loading || offline) {
    return (
      <View style={styles.center}>
        {loading ? (
          <ActivityIndicator size="large" color="#0E8A6B" />
        ) : (
          <>
            <Text style={styles.text}>{t('error.network')}</Text>
            <Button label={t('common.retry')} onPress={retry} />
          </>
        )}
      </View>
    )
  }
  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        {/* SDK 58 sends a closed guard to "/" by default, which only exists while logged in: logout showed "Unmatched Route". */}
        <Stack.Protected guard={!!user} redirectTo="/login">
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
    </>
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
  center: { flex: 1, backgroundColor: '#F2FBF8', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  text: { fontSize: 16, color: '#14352E', textAlign: 'center' },
})
