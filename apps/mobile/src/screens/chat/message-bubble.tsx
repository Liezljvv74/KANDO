import { useState } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'

import { MAX_REPORT_CHARS, type Message } from '@kando/contract'

import { reportMessage } from '@/api/chat'
import { ApiError } from '@/api/client'
import { photoSrc } from '@/api/providers'
import { Button, ErrorText, Field } from '@/components/auth-ui'
import { SmallButton } from '@/components/form-ui'
import { errorText, t } from '@/i18n'
import { formatWhen } from '@/lib/booking-time'
import { CardBubble } from '@/screens/chat/card-bubble'

/** "Report message" under a message of the other side: opens a reason box here (Alert.prompt exists on iOS only). */
function Report({ id }: { id: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function send() {
    if (!reason.trim()) return
    setBusy(true)
    setProblem(null)
    try {
      await reportMessage(id, reason.trim())
      setDone(true)
    } catch (e) {
      setProblem(errorText(e instanceof ApiError ? e.code : 'network'))
    }
    setBusy(false)
  }

  if (done) return <Text style={styles.small}>{t('chat.report.done')}</Text>
  if (!open) return <SmallButton label={t('chat.report.action')} onPress={() => setOpen(true)} />
  return (
    <View style={styles.report}>
      <Field label={t('chat.report.reasonLabel')} value={reason} onChangeText={setReason} maxLength={MAX_REPORT_CHARS} multiline editable={!busy} />
      <ErrorText text={problem} />
      <Button label={t('chat.report.send')} onPress={send} busy={busy} disabled={!reason.trim()} />
    </View>
  )
}

/** One message: the person's own on the right, the other side's on the left (with Report); server cards in the middle. */
export function MessageBubble({ message: m }: { message: Message }) {
  if (m.kind === 'card' && m.card) return <CardBubble card={m.card} />
  const src = photoSrc(m.photoUrl)
  return (
    <View style={[styles.row, m.mine ? styles.mine : styles.theirs]}>
      <View style={[styles.bubble, m.mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {m.kind === 'photo' && src && <Image source={{ uri: src }} accessibilityLabel={t('chat.photo')} style={styles.photo} />}
        {!!m.body && <Text style={styles.text}>{m.body}</Text>}
        <Text style={styles.small}>{formatWhen(m.createdAt)}</Text>
      </View>
      {!m.mine && <Report id={m.id} />}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { marginVertical: 4, maxWidth: '85%', gap: 4 },
  mine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  theirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { borderRadius: 14, padding: 10, gap: 4 },
  bubbleMine: { backgroundColor: '#CDEBE1' },
  bubbleTheirs: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#D5E6E0' },
  photo: { width: 200, height: 200, borderRadius: 10, backgroundColor: '#BFE3D8' },
  text: { fontSize: 16, color: '#14352E' },
  small: { fontSize: 12, color: '#5C7A72' },
  report: { alignSelf: 'stretch', minWidth: 260, gap: 8 },
})
