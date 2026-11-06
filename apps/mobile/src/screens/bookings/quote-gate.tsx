import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { MyProfile } from '@kando/contract'

import { Card } from '@/components/form-ui'
import { t } from '@/i18n'
import { gateHeading, gateRows } from '@/lib/quote-gate'

/** What a provider still needs before quoting: a heading and one row per missing step. `onDo` runs that step's existing flow. */
export function QuoteGate({ steps, onDo, heading }: { heading?: string; steps: NonNullable<MyProfile['quoteSteps']>; onDo: (step: NonNullable<MyProfile['quoteSteps']>[number]) => void }) {
  return (
    <Card>
      <Text style={styles.title} accessibilityRole="header">
        {heading ?? t(gateHeading(steps.length), { n: steps.length })}
      </Text>
      {gateRows(steps).map((r) => (
        <View key={r.step} style={styles.row}>
          <View style={styles.text}>
            <Text style={styles.name}>{t(r.title)}</Text>
            {!!r.hint && <Text style={styles.hint}>{t(r.hint)}</Text>}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={`${t(r.title)}: ${t('quoteGate.doIt')}`} onPress={() => onDo(r.step)} style={styles.doIt}>
            <Text style={styles.doItText}>{t('quoteGate.doIt')}</Text>
          </Pressable>
        </View>
      ))}
    </Card>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '700', color: '#1D1C4A' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 },
  text: { flex: 1 },
  name: { fontSize: 16, color: '#1D1C4A' },
  hint: { fontSize: 14, color: '#4F4E7D' },
  doIt: { minHeight: 44, justifyContent: 'center' },
  doItText: { fontSize: 15, fontWeight: '600', color: '#34328A' },
})
