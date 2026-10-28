import { useRouter } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'

import type { OwnService } from '@kando/contract'

import { Info } from '@/components/auth-ui'
import { Card, EditButton, IconButton, SectionHeader } from '@/components/form-ui'
import { useCategories } from '@/hooks/use-categories'
import { docText, t } from '@/i18n'
import { serviceDocNote, type DocumentRow } from '@/lib/documents'
import { formatPrice } from '@/lib/format'

/** Services; adding and editing happen on their own screens. */
export function ServicesCard({ services, docRows }: { services: OwnService[]; docRows: DocumentRow[] }) {
  const router = useRouter()
  const { categories } = useCategories()
  return (
    <Card>
      <SectionHeader title={t('setup.services')}>
        <IconButton icon="add-circle-outline" label={t('myProfile.addService')} onPress={() => router.push('/my-profile/service/new')} />
      </SectionHeader>
      {services.length === 0 && <Info text={t('setup.noServices')} />}
      {services.map((s) => {
        const name = categories?.find((c) => c.id === s.category)?.name ?? s.title
        const waitingFor = s.waitingFor ?? []
        return (
          <View key={s.id} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.name}>{name}</Text>
              <Text style={styles.status}>{s.priceType ? formatPrice({ ...s, priceType: s.priceType }) : t('setup.noPrice')}</Text>
              {waitingFor.length > 0 && (
                <Text style={styles.waiting}>{t(serviceDocNote(waitingFor, docRows) === 'needed' ? 'myProfile.neededDocs' : 'myProfile.waitingDocs') + waitingFor.map(docText).join(', ')}</Text>
              )}
            </View>
            <EditButton label={`${t('common.edit')}: ${name}`} onPress={() => router.push({ pathname: '/my-profile/service/[id]', params: { id: s.id } })} />
          </View>
        )
      })}
    </Card>
  )
}

const styles = StyleSheet.create({
  name: { fontSize: 17, fontWeight: '700', color: '#14352E' },
  status: { fontSize: 14, color: '#5C7A72' },
  waiting: { fontSize: 14, fontWeight: '600', color: '#8A5A00' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1 },
})
