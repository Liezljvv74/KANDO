import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { Card, EditButton, IconButton, SectionHeader } from '@/components/form-ui'
import { docText, t } from '@/i18n'
import { documentsComplete } from '@/lib/completeness'
import { DOC_COLORS, docTone, groupColor, type DocumentRow } from '@/lib/documents'

/** Verification documents in two collapsible groups. Required: red while one is missing or rejected (open until then). Optional: indigo while nothing of it is uploaded (collapsed). Each document has its own screen. */
export function DocumentsCard({ rows }: { rows: DocumentRow[] }) {
  const done = documentsComplete(rows)
  const required = rows.filter((r) => !r.optional)
  const optional = rows.filter((r) => r.optional)
  return (
    <Card done={done}>
      <SectionHeader title={t('setup.documents.title')} done={done} />
      {required.length > 0 && <Group title={t('setup.documents.required')} rows={required} optional={false} />}
      {optional.length > 0 && <Group title={t('setup.documents.optional')} rows={optional} optional />}
    </Card>
  )
}

function Group({ title, rows, optional }: { title: string; rows: DocumentRow[]; optional: boolean }) {
  const router = useRouter()
  const tone = groupColor(rows, optional)
  const [open, setOpen] = useState(!optional && tone === DOC_COLORS.required) // a missing required document opens its group; the optional group starts closed
  const uploaded = rows.filter((r) => r.state !== 'none').length
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.toggle}>
        <Text style={[styles.groupTitle, { color: tone }]}>{`${title} (${uploaded}/${rows.length})`}</Text>
        <Text style={[styles.groupTitle, { color: tone }]}>{open ? '▴' : '▾'}</Text>
      </Pressable>
      {open &&
        rows.map((r) => {
          const color = DOC_COLORS[docTone(r)]
          const go = () => router.push({ pathname: '/my-profile/document/[requirement]', params: { requirement: r.requirement } })
          return (
            <View key={r.requirement} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={[styles.name, { color }]}>{docText(r.requirement)}</Text>
                <Text style={[styles.status, { color }]}>{t(`myProfile.docs.${r.state}`)}</Text>
                {r.state === 'rejected' && r.note ? <Text style={[styles.status, { color }]}>{r.note}</Text> : null}
              </View>
              {r.state === 'none' ? (
                <IconButton icon="add-circle-outline" label={`${t('setup.documents.add')}: ${docText(r.requirement)}`} onPress={go} />
              ) : (
                <EditButton label={`${t('common.edit')}: ${docText(r.requirement)}`} onPress={go} />
              )}
            </View>
          )
        })}
    </View>
  )
}

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  groupTitle: { fontSize: 16, fontWeight: '700' },
  name: { fontSize: 17, fontWeight: '700' },
  status: { fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  rowText: { flex: 1 },
})
