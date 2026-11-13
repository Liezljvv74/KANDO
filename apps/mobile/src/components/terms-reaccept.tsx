import { TERMS_VERSION } from '@kando/contract'
import { useState } from 'react'
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native'

import { ApiError, updateMe } from '@/api/client'
import { Button, ErrorText } from '@/components/auth-ui'
import { TermsCheckbox } from '@/components/terms-checkbox'
import { loadMe, setAside, useTermsPopup } from '@/hooks/use-me'
import { errorText, t, useLang } from '@/i18n'
import { go } from '@/lib/go'
import { wake } from '@/lib/pending-runner'
import { color, font } from '@/theme'

/**
 * Shown over the whole app after the published Terms changed (TERMS_VERSION raised) and the person accepted an older version.
 * Accepting needs the tick; "I do not agree" sets the pop-up aside and opens the account page, where the account can be deleted
 * (every write is refused with 428 until the new Terms are accepted, which brings the pop-up back).
 */
export function TermsReaccept() {
  useLang()
  const visible = useTermsPopup()
  const [ticked, setTicked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function accept() {
    if (!ticked) return setError(t('terms.reaccept.tick'))
    setBusy(true)
    setError(null)
    try {
      await updateMe({ termsAccepted: true, termsVersion: TERMS_VERSION })
      wake() // changes kept while the Terms were not accepted are sent now
      await loadMe()
      setTicked(false)
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : ''))
    }
    setBusy(false)
  }

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={() => {}} accessibilityViewIsModal>
      <View style={styles.page}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title} accessibilityRole="header">
            {t('terms.reaccept.title')}
          </Text>
          <Text style={styles.text}>{t('terms.reaccept.body')}</Text>
          <TermsCheckbox checked={ticked} onChange={setTicked} sentenceKey="terms.reaccept.sentence" />
          <ErrorText text={error} />
          <Button label={t('terms.reaccept.accept')} onPress={accept} busy={busy} />
          <Text style={styles.small}>{t('terms.reaccept.decline.note')}</Text>
          <Button
            label={t('terms.reaccept.decline')}
            danger
            onPress={() => {
              setAside(true)
              go('/account')
            }}
          />
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  content: { padding: 24, gap: 16, paddingTop: 64 },
  title: { fontSize: 22, fontFamily: font.heading, color: color.ink },
  text: { fontSize: 16, color: color.ink },
  small: { fontSize: 14, color: color.inkMuted },
})
