import { useCallback } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { getProviderMoney } from '@/api/money'
import { useLoad } from '@/hooks/use-load'
import { t, useLang } from '@/i18n'
import { formatPrice } from '@/lib/format'

/** The provider side of Jobs: received this month, on its way, on hold (net), and one line in the smallest text size under them. Nothing while it loads or fails. */
export function MoneyStrip() {
  useLang()
  const { data } = useLoad(useCallback(getProviderMoney, []))
  if (!data) return null
  const cells = [
    ['money.strip.received', data.receivedThisMonth],
    ['money.strip.onItsWay', data.onItsWay],
    ['money.strip.onHold', data.onHold],
  ] as const
  return (
    <View style={styles.box}>
      <View style={styles.row}>
        {cells.map(([key, amount]) => (
          <View key={key} style={styles.cell}>
            <Text style={styles.amount}>{formatPrice({ priceType: 'fixed', price: amount, currency: 'EUR' })}</Text>
            <Text style={styles.small}>{t(key)}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.small}>{t('money.strip.note')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  box: { gap: 4 },
  row: { flexDirection: 'row', gap: 8 },
  cell: { flex: 1, gap: 2 },
  amount: { fontSize: 16, fontWeight: '700', color: '#1D1C4A' },
  small: { fontSize: 12, color: '#4F4E7D' },
})
