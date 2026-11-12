import { useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context'

import { useSession } from '@/hooks/use-session'
import { errorText, t, useLang, type Key } from '@/i18n'
import { COMPULSORY } from '@/lib/compulsory'
import { bannerState, shouldClearGone } from '@/lib/pending-banner-state'
import { usePendingEntries } from '@/lib/pending-saves'
import { color } from '@/theme'

const RETRY_TEXT: Record<'network' | 'busy' | 'auth' | 'waiting', Key> = {
  network: 'pending.retryNetwork',
  busy: 'pending.retryBusy',
  auth: 'pending.retryAuth',
  waiting: 'pending.retryWaiting',
}

let goneFlag = false
const goneListeners = new Set<() => void>()
function setGone(on: boolean) {
  if (goneFlag === on) return
  goneFlag = on
  goneListeners.forEach((fn) => fn())
}
const subscribeGone = (fn: () => void) => {
  goneListeners.add(fn)
  return () => void goneListeners.delete(fn)
}
const getGone = () => goneFlag

/** The notice for a service that no longer exists; kept until tapped (or the account changes), even if the runner fires before the banner mounts. */
export const showServiceGone = () => setGone(true)

/** Over every screen, under the status bar. Not dismissible while a change is pending; gone when the store is empty. */
export function PendingBanner({ children }: { children: ReactNode }) {
  useLang()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const accountId = useSession().user?.id ?? null
  const state = bannerState(usePendingEntries(accountId), accountId)
  const gone = useSyncExternalStore(subscribeGone, getGone, getGone)
  const prevAccount = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (shouldClearGone(prevAccount.current, accountId)) setGone(false)
    prevAccount.current = accountId
  }, [accountId])

  let text: string | null = null
  let onPress: (() => void) | undefined
  if (state?.kind === 'refused') {
    const { first, count } = state
    const label = first.field in COMPULSORY ? t(COMPULSORY[first.field as keyof typeof COMPULSORY].label) : ''
    const error = errorText(first.reason ?? '')
    text = count > 1 ? t('pending.refused', { n: count }) : label ? t('pending.refusedOne', { field: label, error }) : `${error} ${t('pending.tapToFix')}`
    onPress = () => router.push(first.route as never)
  } else if (state) {
    text = t(RETRY_TEXT[state.reason])
  } else if (gone && accountId) {
    text = t('pending.serviceGone')
    onPress = () => setGone(false)
  }

  // One tree whether or not the bar shows: the children keep their place, so the stack is never remounted.
  // While the bar fills the space under the status bar, the screens below get no top inset of their own.
  return (
    <View style={styles.all}>
      {text !== null && (
        <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
          <StatusBar style="light" />
          <Pressable
            onPress={onPress}
            disabled={!onPress}
            style={styles.tap}
            accessibilityRole={onPress ? 'button' : 'alert'}
            accessibilityLiveRegion={onPress ? undefined : 'polite'}
          >
            <Text style={styles.text}>{text}</Text>
          </Pressable>
        </View>
      )}
      <SafeAreaInsetsContext.Provider value={text !== null ? { ...insets, top: 0 } : insets}>
        <View style={styles.all}>{children}</View>
      </SafeAreaInsetsContext.Provider>
    </View>
  )
}

const styles = StyleSheet.create({
  all: { flex: 1 },
  bar: { backgroundColor: color.ink, paddingHorizontal: 16, paddingBottom: 8 },
  tap: { minHeight: 44, justifyContent: 'center' },
  text: { color: color.bg, fontSize: 14, lineHeight: 20 },
})
