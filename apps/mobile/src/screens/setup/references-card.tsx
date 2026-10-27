import { useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'

import type { OwnReference } from '@kando/contract'

import { Info } from '@/components/auth-ui'
import { Card, EditButton, IconButton, SectionHeader } from '@/components/form-ui'
import { t } from '@/i18n'

export const MAX_REFERENCES = 2 // mirrors MAX_PROVIDER_REFERENCES on the server

/** Past jobs; adding and editing happen on their own screens. */
export function ReferencesCard({ references }: { references: OwnReference[] }) {
  const router = useRouter()
  return (
    <Card>
      <SectionHeader title={t('provider.references')}>
        {references.length < MAX_REFERENCES && <IconButton icon="add-circle-outline" label={t('myProfile.addReference')} onPress={() => router.push('/my-profile/reference/new')} />}
      </SectionHeader>
      {references.length === 0 && <Info text={t('myProfile.noReferences')} />}
      {references.map((r) => (
        <View key={r.id} style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.name}>{r.clientName}</Text>
            {r.year ? <Text style={styles.status}>{r.year}</Text> : null}
          </View>
          <EditButton label={`${t('common.edit')}: ${r.clientName}`} onPress={() => router.push({ pathname: '/my-profile/reference/[id]', params: { id: String(r.id) } })} />
        </View>
      ))}
      {references.length >= MAX_REFERENCES && <Info text={t('error.referenceLimit')} />}
    </Card>
  )
}

const styles = StyleSheet.create({
  name: { fontSize: 17, fontWeight: '700', color: '#14352E' },
  status: { fontSize: 14, color: '#5C7A72' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1 },
})
