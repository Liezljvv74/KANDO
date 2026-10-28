import { useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'

import type { PickedFile } from '@/api/client'
import { documentsApi, removeDocument } from '@/api/my-profile'
import { ErrorText } from '@/components/auth-ui'
import { SectionHeader, SmallButton } from '@/components/form-ui'
import { docText, errorText, t } from '@/i18n'
import type { Document } from '@kando/contract'
import { deleteBodyKey, submittedDocs, type DocumentRow } from '@/lib/documents'
import { pickDocument, pickPhoto, tooLarge, uploadErrorCode } from '@/lib/pick'
import { DeniedNotice } from '../my-profile/denied-notice'

/** The red card: one line per required document across all services, with its status and an Add button. */
export function DocumentsCard({ rows, verifications, onChanged }: { rows: DocumentRow[]; verifications: Document[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false) // one submit at a time across the whole card
  const [problem, setProblem] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)

  async function submit(requirement: string, pick: () => Promise<PickedFile | null | 'denied'>) {
    if (busy) return
    setBusy(true)
    setProblem(null)
    setDenied(false)
    try {
      const file = await pick()
      if (file === 'denied') setDenied(true)
      else if (file && tooLarge(file)) setProblem(errorText('File too large'))
      else if (file) {
        await documentsApi.submit(file, requirement)
        onChanged()
      }
    } catch (e) {
      setProblem(errorText(uploadErrorCode(e)))
    }
    setBusy(false)
  }

  async function remove(id: string) {
    if (busy) return
    setBusy(true)
    setProblem(null)
    try {
      await removeDocument(id)
      onChanged()
    } catch (e) {
      setProblem(errorText(uploadErrorCode(e)))
    }
    setBusy(false)
  }

  const confirmRemove = (d: Document) =>
    Alert.alert(t('myProfile.docDeleteTitle'), t(deleteBodyKey(d.status)), [
      { text: t('common.delete'), style: 'destructive', onPress: () => remove(d.id) },
      { text: t('common.cancel'), style: 'cancel' },
    ])

  const choose = (requirement: string) =>
    Alert.alert(docText(requirement), undefined, [
      { text: t('myProfile.docsUpload'), onPress: () => submit(requirement, pickDocument) },
      { text: t('myProfile.docsScan'), onPress: () => submit(requirement, () => pickPhoto('camera', false)) },
      { text: t('myProfile.docsGallery'), onPress: () => submit(requirement, () => pickPhoto('library', false)) },
      { text: t('common.cancel'), style: 'cancel' },
    ])

  return (
    <View style={styles.card}>
      <SectionHeader title={t('setup.documents.title')} />
      <Text style={styles.text}>{t('setup.documents.body')}</Text>
      <ErrorText text={problem} />
      {denied && <DeniedNotice />}
      {rows.map((r) => (
        <View key={r.requirement} style={styles.row}>
          <Text style={[styles.text, styles.doc]}>{docText(r.requirement)}</Text>
          <Text style={styles.text}>{t(`myProfile.docs.${r.state}`)}</Text>
          {r.state === 'rejected' && r.note ? <Text style={styles.text}>{r.note}</Text> : null}
          {(r.state === 'none' || r.state === 'rejected') && (
            <SmallButton label={t('setup.documents.add')} accessibilityLabel={`${t('setup.documents.add')}: ${docText(r.requirement)}`} onPress={() => choose(r.requirement)} busy={busy} />
          )}
          {submittedDocs(r.requirement, verifications).map((d) => (
            <View key={d.id} style={styles.sub}>
              <Text style={styles.text}>{`${new Date(d.createdAt).toLocaleDateString()}: ${t(`myProfile.docs.${d.status}`)}`}</Text>
              <SmallButton label={t('common.delete')} accessibilityLabel={`${t('common.delete')}: ${docText(r.requirement)}`} onPress={() => confirmRemove(d)} busy={busy} />
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FDECEC', borderRadius: 16, padding: 12, gap: 6 },
  text: { fontSize: 15, lineHeight: 21, color: '#8A1C1C' },
  doc: { fontSize: 17, fontWeight: '700' },
  sub: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  row: { gap: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F2C4C4' },
})
