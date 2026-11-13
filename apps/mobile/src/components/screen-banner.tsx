import Ionicons from '@expo/vector-icons/Ionicons'
import { router, type Href } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { HelpFeedbackButtons } from '@/components/help-feedback-buttons'
import { t, useLang } from '@/i18n'
import { goBack } from '@/lib/go'
import { forwardTo, useCanGoForward } from '@/lib/nav-history'
import { color, font } from '@/theme'

/** A small arrow: lit when it can go, dimmed when it cannot. */
function Arrow({ name, label, enabled = true, onPress }: { name: 'arrow-back' | 'arrow-forward'; label: string; enabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !enabled }} disabled={!enabled} onPress={onPress} hitSlop={6} style={[styles.arrow, !enabled && styles.arrowOff]}>
      <Ionicons name={name} size={22} color={color.nav} />
    </Pressable>
  )
}

/**
 * The banner at the top of every screen except Home: the Back arrow at the left, the page header, the Help and Feedback buttons
 * (`hideHelp` leaves Help out, on the Help screen itself) and the Forward arrow at the right. Back always works: with nothing to go
 * back to (a page opened from a link) it opens Home. Forward is the page Back just left. A long header shrinks to fit its one line.
 * It also fills the space under the status bar, so a screen using it does not add the top inset itself.
 */
export function ScreenBanner({ title, hideHelp }: { title: string; hideHelp?: boolean }) {
  useLang()
  const top = useSafeAreaInsets().top
  const canForward = useCanGoForward()
  return (
    <View style={[styles.bar, { paddingTop: top + 6 }]}>
      <Arrow name="arrow-back" label={t('nav.back')} onPress={goBack} />
      <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} accessibilityRole="header">
        {title}
      </Text>
      <HelpFeedbackButtons hideHelp={hideHelp} />
      <Arrow
        name="arrow-forward"
        label={t('nav.forward')}
        enabled={canForward}
        onPress={() => {
          const next = forwardTo()
          if (next) router.push(next as Href)
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { backgroundColor: color.indigo, flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingHorizontal: 8, paddingBottom: 6 },
  title: { flex: 1, fontSize: 22, lineHeight: 28, fontFamily: font.heading, color: color.teal },
  arrow: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  arrowOff: { opacity: 0.3 },
})
