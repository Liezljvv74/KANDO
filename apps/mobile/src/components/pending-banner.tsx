import { useRouter } from 'expo-router'
import { useEffect, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context'

import { useSession } from '@/hooks/use-session'
import { errorText, t, useLang, type Key } from '@/i18n'
import { COMPULSORY } from '@/lib/compulsory'
import { bannerState } from '@/lib/pending-banner-state'
import { usePendingEntries } from '@/lib/pending-saves'
import { color } from '@/theme'

const RETRY_TEXT: Record<'network' | 'busy' | 'auth' | 'waiting', Key> = {
  network: 'pending.retryNetwork',
  busy: 'pending.retryBusy',
  auth: 'pending.retryAuth',
  waiting: 'pending.retryWaiting',
}

/** The one notice a runner shows when a service it was saving no longer exists; cleared by a tap. */
let setGone: ((on: boolean) => void) | null = null
export const showServiceGone = () => setGone?.(true)

/** Over every screen, under the status bar. Not dismissible while a change is pending; gone when the store is empty. */
export function PendingBanner({ children }: { children: ReactNode }) {
  useLang()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const top = insets.top
  const accountId = useSession().user?.id ?? null
  const state = bannerState(usePendingEntries(accountId), accountId)
  const [gone, setGoneState] = useState(false)
  useEffect(() => {
    setGone = setGoneState
    return () => {
      setGone = null
    }
  }, [])

  let text: string
  let onPress: (() => void) | undefined
  if (state?.kind === 'refused') {
    const { first, count } = state
    const label =
      first.field in COMPULSORY ? t(COMPULSORY[first.field as keyof typeof COMPULSORY].label) : ''
    const error = errorText(first.reason ?? '')
    text =
      count > 1
        ? t('pending.refused', { n: count })
        : label
          ? t('pending.refusedOne', { field: label, error })
          : `${error} ${t('pending.tapToFix')}`
    onPress = () => router.push(first.route as never)
  } else if (state) {
    text = t(RETRY_TEXT[state.reason])
  } else if (gone && accountId) {
    text = t('pending.serviceGone')
    onPress = () => setGoneState(false)
  } else {
    return <>{children}</>
  }
  // the bar fills the space under the status bar, so the screens below do not add the top inset again
  return (
    <View style={styles.all}>
      <View style={[styles.bar, { paddingTop: top + 6 }]}>
        <Pressable
          onPress={onPress}
          disabled={!onPress}
          accessibilityRole={onPress ? 'button' : 'alert'}
        >
          <Text style={styles.text}>{text}</Text>
        </Pressable>
      </View>
      <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
        <View style={styles.all}>{children}</View>
      </SafeAreaInsetsContext.Provider>
    </View>
  )
}

const styles = StyleSheet.create({
  all: { flex: 1 },
  bar: { backgroundColor: color.ink, paddingHorizontal: 16, paddingBottom: 8 },
  text: { color: color.bg, fontSize: 14, lineHeight: 20 },
})
