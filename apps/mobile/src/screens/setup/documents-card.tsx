import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { Card, EditButton, IconButton, SectionHeader } from '@/components/form-ui'
import { docText, t } from '@/i18n'
import { documentsComplete } from '@/lib/completeness'
import { DOC_COLORS, docTone, groupColor, groupNeedsAction, type DocumentRow } from '@/lib/documents'
import { foldArrow } from '@/theme'

/** Verification documents in two collapsible groups with an approved count each. A group that needs attention (a required document missing or rejected, an optional one rejected) is red and open; the optional group is indigo while nothing of it is uploaded. Each document has its own screen. */
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
  const alert = groupNeedsAction(rows, optional)
  const [open, setOpen] = useState(alert) // a group that needs attention starts open, the others closed
  useEffect(() => {
    if (alert) setOpen(true) // a document rejected or deleted later opens it too
  }, [alert])
  const approved = rows.filter((r) => r.state === 'approved').length
  return (
    <View>
      <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={styles.toggle}>
        <Text style={[styles.groupTitle, { color: tone }]}>{`${title} (${approved}/${rows.length})`}</Text>
        <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.groupTitle, { color: tone }, foldArrow]}>{open ? '▴' : '▾'}</Text>
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
