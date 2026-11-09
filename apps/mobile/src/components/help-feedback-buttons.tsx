import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'

import { FeedbackForm } from '@/components/feedback-form'
import { t, useLang } from '@/i18n'
import { color, font } from '@/theme'

/**
 * The small Help and Feedback buttons (screen banner and Home hero). Feedback opens the feedback form;
 * Help is still a "Coming soon" placeholder until the Help screen is built.
 */
export function HelpFeedbackButtons() {
  useLang()
  const [open, setOpen] = useState<'help' | 'feedback' | null>(null)
  return (
    <View style={styles.row}>
      {(['help', 'feedback'] as const).map((key) => (
        <Pressable key={key} accessibilityRole="button" onPress={() => setOpen(key)} hitSlop={6} style={styles.button}>
          <Text style={styles.buttonText}>{t(key === 'help' ? 'banner.help' : 'banner.feedback')}</Text>
        </Pressable>
      ))}
      <Modal transparent visible={open === 'help'} animationType="fade" onRequestClose={() => setOpen(null)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('banner.help')}</Text>
            <Text style={styles.cardText}>{t('banner.soon')}</Text>
            <Pressable accessibilityRole="button" onPress={() => setOpen(null)} style={styles.close}>
              <Text style={styles.closeText}>{t('common.close')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <FeedbackForm visible={open === 'feedback'} onClose={() => setOpen(null)} />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  button: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: color.teal, marginBottom: 3 },
  buttonText: { fontSize: 12, fontWeight: '600', color: color.surface },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: color.surface, borderRadius: 6, padding: 16, gap: 8, width: '100%', maxWidth: 360 },
  cardTitle: { fontSize: 18, fontFamily: font.heading, color: color.indigo },
  cardText: { fontSize: 15, color: color.ink },
  close: { alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 12 },
  closeText: { fontSize: 15, fontWeight: '600', color: color.indigo },
})
