import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

import { REQUEST_TIMEOUT_MS } from '@/api/client'
import { removePushToken, savePushToken } from '@/api/push'

/** This device's token once the server has it (memory only, never stored); null until then and after sign-out. */
let token: string | null = null
let running: Promise<void> | null = null

/**
 * Asks for permission and gives the server this device's push token. Called at every session start and when a push switch
 * is turned on; does nothing once registered this session. Never throws: a simulator, a refusal, a build without the EAS
 * project id or a lost connection just leave this device without pushes (the next call tries again).
 */
export function registerForPush(): Promise<void> {
  if (token) return Promise.resolve()
  running ??= register()
    .catch((e) => {
      if (__DEV__) console.warn('push registration failed:', e)
    })
    .finally(() => (running = null))
  return running
}

async function register() {
  if (!Device.isDevice || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId
  if (!projectId) return
  // Android 13+ asks for permission only once a channel exists.
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: 'default', importance: Notifications.AndroidImportance.DEFAULT })
  const now = await Notifications.getPermissionsAsync()
  const granted = now.granted || (now.canAskAgain && (await Notifications.requestPermissionsAsync()).granted)
  if (!granted) return
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId })
  await savePushToken(data, Platform.OS)
  token = data
}

/** On sign-out, before the session is dropped: the server forgets this device. Never throws; an unsent delete is harmless (the next sign-in on this phone moves the token). */
export async function unregisterPush(): Promise<void> {
  // A registration still running is waited for (its token is deleted too), but never longer than a read may take.
  if (running) await Promise.race([running, new Promise((r) => setTimeout(r, REQUEST_TIMEOUT_MS))])
  const t = token
  token = null
  if (t) await removePushToken(t).catch(() => {})
}

/** The app route a push link (`data.url`) opens: a booking, request, thread, invoice, provider page or the profile tab. Anything else is null and ignored. */
export function pushRoute(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const m = /^skilled:\/\/((?:bookings(?:\/request)?|threads|invoices|provider)\/[\w-]{1,100}|my-profile)$/.exec(url)
  return m ? `/${m[1]}` : null
}
