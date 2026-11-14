import Ionicons from '@expo/vector-icons/Ionicons'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { t, useLang } from '@/i18n'
import { openLegal as openPage } from '@/lib/legal-links'
import { splitSentence } from '@/lib/terms-sentence'
import { color } from '@/theme'

/** The tick for the Terms and the Privacy Policy. A tap on the box or on the words ticks it; a tap on a link opens the page. A screen reader finds the box and the sentence, and the sentence offers the two pages as actions (a nested link inside a Text is not focusable on its own on iOS). */
export function TermsCheckbox({ checked, onChange, sentenceKey = 'auth.termsSentence' }: { checked: boolean; onChange: (v: boolean) => void; sentenceKey?: 'auth.termsSentence' | 'terms.reaccept.sentence' }) {
  useLang()
  const parts = splitSentence(t(sentenceKey), { terms: t('auth.termsLink'), privacy: t('auth.privacyLink') })
  return (
    <View style={styles.row}>
      <Pressable style={styles.box} onPress={() => onChange(!checked)} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={t('auth.termsLabel')} hitSlop={8}>
        <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={26} color={color.indigo} />
      </Pressable>
      <Text
        style={styles.text}
        onPress={() => onChange(!checked)}
        accessibilityActions={[{ name: 'terms', label: t('auth.termsLink') }, { name: 'privacy', label: t('auth.privacyLink') }]}
        onAccessibilityAction={(e) => openPage(e.nativeEvent.actionName === 'terms' ? 'agb' : 'datenschutz')}
      >
        {parts.map((p, i) =>
          p.link ? (
            <Text key={i} style={styles.link} accessibilityRole="link" accessibilityHint={t('auth.termsOpens')} onPress={() => openPage(p.link === 'terms' ? 'agb' : 'datenschutz')}>
              {p.text}
            </Text>
          ) : (
            p.text
          ),
        )}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 44 },
  box: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, fontSize: 15, color: color.ink, paddingTop: 10 },
  link: { color: color.ink, textDecorationLine: 'underline' },
})
