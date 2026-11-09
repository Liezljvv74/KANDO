import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { getProviderMoney } from '@/api/money'
import { useLoad } from '@/hooks/use-load'
import { t, useLang, type Key } from '@/i18n'
import { STRIP_KEYS as KEYS, stripCells } from '@/lib/money-strip'
import { color } from '@/theme'

/** The provider side of Jobs: received this month, on its way, on hold (net), and one line in the smallest text size under them. Nothing while it loads or fails. */
export function MoneyStrip() {
  useLang()
  const { data } = useLoad(useCallback(getProviderMoney, []))
  const [info, setInfo] = useState<(typeof KEYS)[number] | null>(null) // the amount whose explanation is open
  const cells = stripCells(data)
  if (!cells) return null
  return (
    <View style={styles.box}>
      <View style={styles.row}>
        {cells.map(([key, shown]) => (
          <View key={key} style={styles.cell}>
            <View style={styles.labelRow}>
              <Text style={styles.amount}>{shown}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`${t(key)}: ${t('money.info.open')}`} accessibilityState={{ expanded: info === key }} hitSlop={8} onPress={() => setInfo(info === key ? null : key)}>
                <Text style={styles.i}>(i)</Text>
              </Pressable>
            </View>
            <Text style={styles.small}>{t(key)}</Text>
          </View>
        ))}
      </View>
      {info && <Text style={styles.explain}>{t(`${info}.info` as Key)}</Text>}
      <Text style={styles.small}>{t('money.strip.note')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  box: { gap: 4 },
  row: { flexDirection: 'row', gap: 8 },
  cell: { flex: 1, gap: 2 },
  amount: { fontSize: 16, fontWeight: '700', color: color.ink },
  small: { fontSize: 12, color: color.inkMuted },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  i: { fontSize: 12, fontWeight: '700', color: color.indigo },
  explain: { fontSize: 13, color: color.ink, backgroundColor: color.surface, borderRadius: 4, padding: 8 },
})
