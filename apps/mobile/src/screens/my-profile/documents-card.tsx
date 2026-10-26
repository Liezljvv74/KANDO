import { useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'

import type { PickedFile } from '@/api/client'
import { documentsApi } from '@/api/my-profile'
import { ErrorText } from '@/components/auth-ui'
import { Card, IconButton, SectionHeader } from '@/components/form-ui'
import { docText, errorText, t } from '@/i18n'
import type { DocumentRow } from '@/lib/documents'
import { pickDocument, pickPhoto, tooLarge, uploadErrorCode } from '@/lib/pick'
import { DeniedNotice } from './denied-notice'

export function DocumentsCard({ rows, onChanged }: { rows: DocumentRow[]; onChanged: () => void }) {
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

  const choose = (requirement: string) =>
    Alert.alert(docText(requirement), undefined, [
      { text: t('myProfile.docsUpload'), onPress: () => submit(requirement, pickDocument) },
      { text: t('myProfile.docsScan'), onPress: () => submit(requirement, () => pickPhoto('camera', false)) },
      { text: t('myProfile.docsGallery'), onPress: () => submit(requirement, () => pickPhoto('library', false)) },
      { text: t('common.cancel'), style: 'cancel' },
    ])

  return (
    <Card>
      <SectionHeader title={t('myProfile.docsTitle')} />
      <Text style={styles.intro}>{t('myProfile.docsIntro')}</Text>
      <ErrorText text={problem} />
      {denied && <DeniedNotice />}
      {rows.map((r) => (
        // Not a nested card: the document name sits flush left and stands out, so it cannot be missed.
        <View key={r.requirement} style={styles.row}>
          <View style={styles.docRow}>
            <Text style={styles.doc}>{docText(r.requirement)}</Text>
            {(r.state === 'none' || r.state === 'rejected') && (
              <IconButton icon="cloud-upload-outline" label={`${t('myProfile.docsUpload')}: ${docText(r.requirement)}`} onPress={() => choose(r.requirement)} busy={busy} />
            )}
          </View>
          <Text>{t(`myProfile.docs.${r.state}`)}</Text>
          {r.state === 'rejected' && r.note ? <ErrorText text={r.note} /> : null}
        </View>
      ))}
    </Card>
  )
}

const styles = StyleSheet.create({
  intro: { fontSize: 15, lineHeight: 21, color: '#14352E' },
  row: { gap: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#E1F4EE' },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  doc: { flex: 1, fontSize: 17, fontWeight: '700', color: '#0E8A6B' },
})
