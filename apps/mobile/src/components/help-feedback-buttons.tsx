import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { FeedbackForm } from '@/components/feedback-form'
import { t, useLang } from '@/i18n'
import { go } from '@/lib/go'
import { color } from '@/theme'

/**
 * The small Help and Feedback buttons (screen banner and Home hero). Help opens the Help screen (left out on the Help screen
 * itself: `hideHelp`); Feedback opens the feedback form.
 */
export function HelpFeedbackButtons({ hideHelp }: { hideHelp?: boolean }) {
  useLang()
  const [feedback, setFeedback] = useState(false)
  return (
    <View style={styles.row}>
      {!hideHelp && (
        <Pressable accessibilityRole="button" onPress={() => go('/help')} hitSlop={6} style={styles.button}>
          <Text style={styles.buttonText}>{t('banner.help')}</Text>
        </Pressable>
      )}
      <Pressable accessibilityRole="button" onPress={() => setFeedback(true)} hitSlop={6} style={styles.button}>
        <Text style={styles.buttonText}>{t('banner.feedback')}</Text>
      </Pressable>
      <FeedbackForm visible={feedback} onClose={() => setFeedback(false)} />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  button: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: color.teal, marginBottom: 3 },
  buttonText: { fontSize: 12, fontWeight: '600', color: color.surface },
})
