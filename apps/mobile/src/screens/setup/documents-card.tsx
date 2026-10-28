import { useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'

import { Card, EditButton, IconButton, SectionHeader } from '@/components/form-ui'
import { docText, t } from '@/i18n'
import { DOC_COLORS, docTone, type DocumentRow } from '@/lib/documents'

/** Verification documents, required ones first: a compulsory one not yet approved is red, an optional one orange; each has its own screen. */
export function DocumentsCard({ rows }: { rows: DocumentRow[] }) {
  const router = useRouter()
  return (
    <Card>
      <SectionHeader title={t('setup.documents.title')} />
      {rows.map((r) => {
        const color = DOC_COLORS[docTone(r)]
        const open = () => router.push({ pathname: '/my-profile/document/[requirement]', params: { requirement: r.requirement } })
        return (
          <View key={r.requirement} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={[styles.name, { color }]}>{docText(r.requirement)}</Text>
              {r.optional && <Text style={[styles.status, { color }]}>{t('doc.optional')}</Text>}
              <Text style={[styles.status, { color }]}>{t(`myProfile.docs.${r.state}`)}</Text>
              {r.state === 'rejected' && r.note ? <Text style={[styles.status, { color }]}>{r.note}</Text> : null}
            </View>
            {r.state === 'none' ? (
              <IconButton icon="add-circle-outline" label={`${t('setup.documents.add')}: ${docText(r.requirement)}`} onPress={open} />
            ) : (
              <EditButton label={`${t('common.edit')}: ${docText(r.requirement)}`} onPress={open} />
            )}
          </View>
        )
      })}
    </Card>
  )
}

const styles = StyleSheet.create({
  name: { fontSize: 17, fontWeight: '700' },
  status: { fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1 },
})
