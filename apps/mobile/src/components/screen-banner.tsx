import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { t, useLang } from '@/i18n'
import { color, font } from '@/theme'

/**
 * The banner at the top of every screen except Home: the page header on one line, with the Help and Feedback buttons at the
 * bottom right. Both buttons are placeholders for now (they only show "Coming soon"); the Feedback form and the Help search come later.
 * It also fills the space under the status bar, so a screen using it does not add the top inset itself.
 */
export function ScreenBanner({ title }: { title: string }) {
  useLang()
  const top = useSafeAreaInsets().top
  const [soon, setSoon] = useState<'banner.help' | 'banner.feedback' | null>(null)
  return (
    <View style={[styles.bar, { paddingTop: top + 6 }]}>
      <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      {(['banner.help', 'banner.feedback'] as const).map((key) => (
        <Pressable key={key} accessibilityRole="button" onPress={() => setSoon(key)} hitSlop={6} style={styles.button}>
          <Text style={styles.buttonText}>{t(key)}</Text>
        </Pressable>
      ))}
      <Modal transparent visible={soon !== null} animationType="fade" onRequestClose={() => setSoon(null)}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{soon ? t(soon) : ''}</Text>
            <Text style={styles.cardText}>{t('banner.soon')}</Text>
            <Pressable accessibilityRole="button" onPress={() => setSoon(null)} style={styles.close}>
              <Text style={styles.closeText}>{t('common.close')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { backgroundColor: color.indigo, flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingBottom: 6 },
  title: { flex: 1, fontSize: 22, lineHeight: 28, fontFamily: font.heading, color: color.teal },
  button: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: color.teal, marginBottom: 3 },
  buttonText: { fontSize: 12, fontWeight: '600', color: color.surface },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: color.surface, borderRadius: 6, padding: 16, gap: 8, width: '100%', maxWidth: 360 },
  cardTitle: { fontSize: 18, fontFamily: font.heading, color: color.indigo },
  cardText: { fontSize: 15, color: color.ink },
  close: { alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 12 },
  closeText: { fontSize: 15, fontWeight: '600', color: color.indigo },
})
