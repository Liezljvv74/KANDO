import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { MyProfile } from '@kando/contract'

import { Card } from '@/components/form-ui'
import { t, type Key } from '@/i18n'
import { gateHeading, gateRows } from '@/lib/quote-gate'
import { color } from '@/theme'

/** What a provider still needs before quoting: a heading and one row per missing step. `onDo` runs that step's existing flow. */
export function QuoteGate({ steps, onDo, heading, note }: { heading?: string; note?: string; steps: NonNullable<MyProfile['quoteSteps']>; onDo: (step: NonNullable<MyProfile['quoteSteps']>[number]) => void }) {
  const rows = gateRows(steps) // the count counts what is shown (a step this app does not know is not a row)
  return (
    <Card>
      <Text style={styles.title} accessibilityRole="header">
        {heading ?? t(gateHeading(rows.length), { n: rows.length })}
      </Text>
      {!!note && <Text style={styles.hint}>{note}</Text>}
      {rows.map((r) => (
        <GateRow key={r.step} title={r.title} hint={r.hint} onDo={() => onDo(r.step)} />
      ))}
    </Card>
  )
}

/** One row: a name, an optional hint, and "Do it ›"; the whole row is the button. Shared by the quote gate and the Live checklist. */
export function GateRow({ title, hint, onDo }: { title: Key; hint?: Key; onDo: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${t(title)}: ${t('quoteGate.doIt')}`} accessibilityHint={hint ? t(hint) : undefined} onPress={onDo} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.text}>
        <Text style={styles.name}>{t(title)}</Text>
        {!!hint && <Text style={styles.hint}>{t(hint)}</Text>}
      </View>
      <Text style={styles.doItText}>{t('quoteGate.doIt')}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '700', color: color.ink },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 44 },
  text: { flex: 1 },
  name: { fontSize: 16, color: color.ink },
  hint: { fontSize: 14, color: color.inkMuted },
  pressed: { opacity: 0.6 },
  doItText: { fontSize: 15, fontWeight: '600', color: color.indigo },
})
