import { FEEDBACK_MESSAGE_MAX } from '@kando/contract'
import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'

import { feedbackErrorKey, feedbackProblem, sendFeedback } from '@/api/feedback'
import { Button, ErrorText, Field, LinkText } from '@/components/auth-ui'
import { useSession } from '@/hooks/use-session'
import { t, useLang, type Key } from '@/i18n'
import { color, font } from '@/theme'

/**
 * The Feedback form as a bottom sheet: email (filled from the account when signed in, editable) and a comment, emailed to the team.
 * States: editing (with the problem shown), sending, thank-you. A failed send keeps the text so it can be sent again.
 */
export function FeedbackForm({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  useLang()
  const accountEmail = useSession().user?.email ?? ''
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [problem, setProblem] = useState<Key | null>(null)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [failed, setFailed] = useState(false)

  // A fresh form every time the sheet opens.
  useEffect(() => {
    if (!visible) return
    setEmail(accountEmail)
    setMessage('')
    setProblem(null)
    setSending(false)
    setSent(false)
    setFailed(false)
  }, [visible, accountEmail])

  async function send() {
    const found = feedbackProblem(email, message)
    setProblem(found)
    if (found) return
    setSending(true)
    setFailed(false)
    try {
      await sendFeedback({ email: email.trim(), message: message.trim() })
      setSent(true)
    } catch (e) {
      const key = feedbackErrorKey(e)
      setProblem(key)
      setFailed(key === 'feedback.error.failed' || key === 'error.network')
    }
    setSending(false)
  }

  const emailError = problem === 'feedback.error.email' ? t(problem) : null
  const messageError = problem === 'feedback.error.empty' || problem === 'feedback.error.tooLong' ? t(problem, { max: FEEDBACK_MESSAGE_MAX }) : null
  const otherError = problem && !emailError && !messageError ? t(problem) : null

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent navigationBarTranslucent onRequestClose={onClose} accessibilityViewIsModal>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')} />
        <SafeAreaView style={styles.sheet} edges={['bottom']}>
          <View style={styles.head}>
            <Text style={styles.title} accessibilityRole="header">
              {t('feedback.title')}
            </Text>
          </View>
          {sent ? (
            <View style={styles.body}>
              <Text style={styles.thanks} accessibilityRole="alert">
                {t('feedback.thanks')}
              </Text>
              <Button label={t('common.close')} onPress={onClose} />
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <Text style={styles.intro}>{t('feedback.intro')}</Text>
              <Field
                label={t('feedback.email')}
                hint={t('feedback.emailHint')}
                value={email}
                onChangeText={setEmail}
                error={emailError}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                editable={!sending}
              />
              <Field
                label={t('feedback.message')}
                hint={t('feedback.messageHint', { max: FEEDBACK_MESSAGE_MAX })}
                value={message}
                onChangeText={setMessage}
                error={messageError}
                multiline
                textAlignVertical="top"
                style={styles.multiline}
                editable={!sending}
              />
              <Text style={[styles.counter, message.trim().length > FEEDBACK_MESSAGE_MAX && styles.counterOver]} accessibilityLiveRegion="polite">
                {t('feedback.counter', { count: message.trim().length, max: FEEDBACK_MESSAGE_MAX })}
              </Text>
              <ErrorText text={otherError} />
              <Button label={failed ? t('feedback.retry') : t('feedback.send')} onPress={send} busy={sending} a11yLabel={sending ? t('feedback.sending') : undefined} />
              <LinkText label={t('common.cancel')} onPress={onClose} disabled={sending} />
            </ScrollView>
          )}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: color.surface, borderTopLeftRadius: 12, borderTopRightRadius: 12, maxHeight: '90%' },
  head: { padding: 16, paddingBottom: 0 },
  title: { fontSize: 22, fontFamily: font.heading, color: color.indigo },
  body: { padding: 16, gap: 12 },
  intro: { fontSize: 15, lineHeight: 21, color: color.ink },
  multiline: { minHeight: 120, paddingTop: 10 },
  counter: { fontSize: 13, color: color.inkMuted, alignSelf: 'flex-end' },
  counterOver: { color: color.danger },
  thanks: { fontSize: 18, lineHeight: 25, fontFamily: font.heading, color: color.ink },
})
