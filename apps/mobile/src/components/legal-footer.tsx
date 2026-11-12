import { Pressable, StyleSheet, Text, View } from 'react-native'

import { t, useLang } from '@/i18n'
import { openLegal, type LegalSlug } from '@/lib/legal-links'
import { color } from '@/theme'

const LINKS: [LegalSlug, 'web.footer.terms' | 'web.footer.privacy' | 'web.footer.impressum'][] = [
  ['agb', 'web.footer.terms'],
  ['datenschutz', 'web.footer.privacy'],
  ['impressum', 'web.footer.impressum'],
]

/** Terms, Privacy and Legal notice as small links at the end of the content (not fixed). Opens the website pages in the browser. */
export function LegalFooter({ onDark }: { onDark?: boolean }) {
  useLang()
  return (
    <View style={styles.row}>
      {LINKS.map(([slug, key]) => (
        <Pressable key={slug} accessibilityRole="link" onPress={() => openLegal(slug)} style={styles.link}>
          <Text style={[styles.text, onDark && { color: color.onIndigoMuted }]}>{t(key)}</Text>
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 4, paddingVertical: 8 },
  link: { minHeight: 44, paddingHorizontal: 10, justifyContent: 'center' },
  text: { fontSize: 13, color: color.inkMuted, textDecorationLine: 'underline' },
})
