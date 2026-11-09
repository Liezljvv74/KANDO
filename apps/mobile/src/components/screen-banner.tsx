import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { HelpFeedbackButtons } from '@/components/help-feedback-buttons'
import { useLang } from '@/i18n'
import { color, font } from '@/theme'

/**
 * The banner at the top of every screen except Home: the page header on one line, with the Help and Feedback buttons at the
 * bottom right (Feedback opens the feedback form; Help is a "Coming soon" placeholder until the Help screen is built).
 * It also fills the space under the status bar, so a screen using it does not add the top inset itself.
 */
export function ScreenBanner({ title }: { title: string }) {
  useLang()
  const top = useSafeAreaInsets().top
  return (
    <View style={[styles.bar, { paddingTop: top + 6 }]}>
      <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      <HelpFeedbackButtons />
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { backgroundColor: color.indigo, flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingBottom: 6 },
  title: { flex: 1, fontSize: 22, lineHeight: 28, fontFamily: font.heading, color: color.teal },
})
