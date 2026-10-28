import { useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'

import type { Document } from '@kando/contract'

import type { PickedFile } from '@/api/client'
import { documentsApi, removeDocument, servicesApi } from '@/api/my-profile'
import { ErrorText } from '@/components/auth-ui'
import { Card, FormScreen, SmallButton } from '@/components/form-ui'
import { Empty, ErrorRetry, Loading } from '@/components/state-view'
import { useCategories } from '@/hooks/use-categories'
import { useLoad } from '@/hooks/use-load'
import { docText, errorText, t, useLang } from '@/i18n'
import { DOC_COLORS, deleteBodyKey, docTone, documentRows, submittedDocs, type DocumentRow } from '@/lib/documents'
import { pickDocument, pickPhoto, tooLarge, uploadErrorCode } from '@/lib/pick'
import { DeniedNotice } from './denied-notice'

const loadAll = async () => ({ services: await servicesApi.list(), verifications: await documentsApi.list() })

/** One verification document: its state, the files sent so far, and upload / delete. */
export default function DocumentScreen({ requirement }: { requirement: string }) {
  useLang()
  const { categories } = useCategories()
  const { done, data, error, retry } = useLoad(loadAll)
  const row = data && documentRows(data.services, categories ?? [], data.verifications).find((r) => r.requirement === requirement)
  return (
    <FormScreen title={docText(requirement)}>
      {!done || !categories ? error ? <ErrorRetry code={error} onRetry={retry} /> : <Loading /> : !row ? <Empty text={t('error.notFound')} /> : <DocumentView row={row} verifications={data!.verifications} onChanged={retry} />}
    </FormScreen>
  )
}

function DocumentView({ row, verifications, onChanged }: { row: DocumentRow; verifications: Document[]; onChanged: () => void }) {
  const requirement = row.requirement
  const [busy, setBusy] = useState(false) // one submit at a time
  const [problem, setProblem] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)

  async function submit(pick: () => Promise<PickedFile | null | 'denied'>) {
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

  const choose = () =>
    Alert.alert(docText(requirement), undefined, [
      { text: t('myProfile.docsUpload'), onPress: () => submit(pickDocument) },
      { text: t('myProfile.docsScan'), onPress: () => submit(() => pickPhoto('camera', false)) },
      { text: t('myProfile.docsGallery'), onPress: () => submit(() => pickPhoto('library', false)) },
      { text: t('common.cancel'), style: 'cancel' },
    ])

  return (
    <Card>
      {row.optional && <Text style={styles.text}>{t('doc.optional')}</Text>}
      <Text style={[styles.state, { color: DOC_COLORS[docTone(row)] }]}>{t(`myProfile.docs.${row.state}`)}</Text>
      {row.state === 'rejected' && row.note ? <Text style={styles.text}>{row.note}</Text> : null}
      <ErrorText text={problem} />
      {denied && <DeniedNotice />}
      {(row.state === 'none' || row.state === 'rejected') && <SmallButton label={t('setup.documents.add')} accessibilityLabel={`${t('setup.documents.add')}: ${docText(requirement)}`} onPress={choose} busy={busy} />}
      {submittedDocs(requirement, verifications).map((d) => (
        <View key={d.id} style={styles.sub}>
          <Text style={styles.text}>{`${new Date(d.createdAt).toLocaleDateString()}: ${t(`myProfile.docs.${d.status}`)}`}</Text>
          <SmallButton label={t('common.delete')} accessibilityLabel={`${t('common.delete')}: ${docText(requirement)}`} onPress={() => confirmRemove(d)} busy={busy} />
        </View>
      ))}
    </Card>
  )
}

const styles = StyleSheet.create({
  text: { fontSize: 15, lineHeight: 21, color: '#14352E' },
  state: { fontSize: 17, fontWeight: '700' },
  sub: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
})
